import {
  createVoxelAdaptiveState,
  selectVoxelWorkerProfile,
  updateVoxelAdaptiveTarget,
} from "../src/client/features/world-view/lib/voxel-adaptive-workers.js";

interface SyntheticJob {
  id: string;
  camera: string;
  releaseAt: number;
  durationMs: number;
  bytes: number;
  focus: boolean;
}

interface ActiveJob extends SyntheticJob {
  startedAt: number;
  completesAt: number;
  reservation: number;
}

const FRAME_MS = 16;
const OUTPUT_LIMIT = 96 * 1024 * 1024;
const MODES = [
  "fixed-1",
  "fixed-2",
  "adaptive-healthy",
  "adaptive-unhealthy",
] as const;

// The opening focus subset drains long before the old three-second startup
// cooldown, while ordinary executable detail keeps the base wave saturated.
const jobs = Array.from({ length: 32 }, (_, index) => ({
  id: `fallback-wave-${index + 1}`,
  camera: "fallback-base-wave",
  releaseAt: 0,
  durationMs: 400 + ((index * 29) % 90),
  bytes: Math.round(2.5 * 1024 ** 2 + ((index * 104_729) % (1.5 * 1024 ** 2))),
  focus: index < 4,
}));

const results = MODES.map((mode) => [mode, simulate(mode)] as const);
console.log(
  "| Policy | Target transitions | Base-visible p50/p95/max (ms) | Frame p95 (ms) | Completion identity |",
);
console.log("|---|---:|---:|---:|---|");
for (const [mode, result] of results) {
  console.log(
    `| ${mode} | ${result.targetTransitions} | ${result.baseVisibleP50.toFixed(0)} / ${result.baseVisibleP95.toFixed(0)} / ${result.baseVisibleMax.toFixed(0)} | ${result.frameP95.toFixed(1)} | ${result.completionIdentity} |`,
  );
}

const fixedTwo = results.find(([mode]) => mode === "fixed-2")?.[1];
const adaptiveHealthy = results.find(
  ([mode]) => mode === "adaptive-healthy",
)?.[1];
if (!fixedTwo || !adaptiveHealthy) throw new Error("Missing comparison result");
if (adaptiveHealthy.maximumTarget !== 2) {
  throw new Error("Healthy adaptive fallback policy did not reach target two");
}
if (adaptiveHealthy.baseVisibleP95 > fixedTwo.baseVisibleP95 * 1.25) {
  throw new Error("Adaptive base-visible p95 exceeded the fixed-two allowance");
}

function simulate(mode: (typeof MODES)[number]) {
  const profile = selectVoxelWorkerProfile({
    coarsePointer: null,
    deviceMemoryGb: null,
  });
  let adaptive = createVoxelAdaptiveState(profile);
  const queue: SyntheticJob[] = [];
  const active: ActiveJob[] = [];
  const scene: Array<SyntheticJob & { completedAt: number }> = [];
  const frameTimes: number[] = [];
  const baseVisible: number[] = [];
  const completionIds: string[] = [];
  let nextJob = 0;
  let loadedBytes = 0;
  let oldestFocus = 0;
  let sceneBacklog = 0;
  let expandedPeak = 0;
  let memoryPeak = 0;
  const endAt = 16_000;

  for (let now = 0; now <= endAt; now += FRAME_MS) {
    while ((jobs[nextJob]?.releaseAt ?? Number.POSITIVE_INFINITY) <= now) {
      queue.push(jobs[nextJob] as SyntheticJob);
      nextJob++;
    }
    queue.sort(
      (left, right) =>
        Number(right.focus) - Number(left.focus) ||
        left.releaseAt - right.releaseAt,
    );

    const fixedTarget = mode.startsWith("fixed-") ? Number(mode.at(-1)) : null;
    const target = fixedTarget ?? adaptive.targetWorkers;
    let reservedBytes = active.reduce((sum, job) => sum + job.reservation, 0);
    const sceneBytes = scene.reduce((sum, job) => sum + job.bytes, 0);
    while (active.length < target && queue.length > 0) {
      const candidate = queue[0] as SyntheticJob;
      const reservation = Math.round(candidate.bytes * 0.75);
      if (
        active.length + scene.length > 0 &&
        reservedBytes + sceneBytes + reservation > OUTPUT_LIMIT
      ) {
        break;
      }
      queue.shift();
      active.push({
        ...candidate,
        startedAt: now,
        completesAt: now + candidate.durationMs,
        reservation,
      });
      reservedBytes += reservation;
    }

    let completions = 0;
    for (let index = active.length - 1; index >= 0; index--) {
      const job = active[index] as ActiveJob;
      if (job.completesAt > now) continue;
      active.splice(index, 1);
      scene.push({ ...job, completedAt: now });
      completions++;
    }
    const inserted = scene.shift();
    if (inserted) {
      baseVisible.push(now - inserted.releaseAt);
      completionIds.push(inserted.id);
      loadedBytes += inserted.bytes;
    }

    const currentFocusAges = [...queue, ...active]
      .filter((job) => job.focus)
      .map((job) => now - job.releaseAt);
    oldestFocus = Math.max(oldestFocus, ...currentFocusAges, 0);
    sceneBacklog = Math.max(sceneBacklog, scene.length);
    const currentExpanded =
      active.reduce((sum, job) => sum + job.reservation, 0) +
      scene.reduce((sum, job) => sum + job.bytes, 0);
    expandedPeak = Math.max(expandedPeak, currentExpanded);
    memoryPeak = Math.max(memoryPeak, loadedBytes + currentExpanded);
    const frameTime =
      9 + completions * 1.2 + (inserted ? inserted.bytes / (4 * 1024 ** 2) : 0);
    frameTimes.push(frameTime);

    if (mode.startsWith("adaptive-")) {
      adaptive = updateVoxelAdaptiveTarget(
        adaptive,
        {
          now,
          executableBaseJobs: queue.length + active.length + scene.length,
          oldestExecutableBaseAgeMs: Math.max(
            ...[...queue, ...active, ...scene].map(
              (job) => now - job.releaseAt,
            ),
            0,
          ),
          frameTimeMs: frameTime,
          // A completed worker immediately receives another queued base job in
          // production; model that handoff rather than treating the frame's
          // completion bookkeeping gap as idle time.
          workerBusyRatio: active.length > 0 || queue.length > 0 ? 1 : 0,
          workerDurationMs: active.reduce(
            (max, job) => Math.max(max, job.durationMs),
            0,
          ),
          sceneBacklogJobs: scene.length,
          sceneBacklogBytes: scene.reduce((sum, job) => sum + job.bytes, 0),
          reservedBytes: active.reduce((sum, job) => sum + job.reservation, 0),
          expandedBytes: currentExpanded,
          memoryPressure: memoryPeak / 1024 / 1024 ** 2,
          interacting: mode === "adaptive-unhealthy",
        },
        profile,
      );
    }
  }

  return {
    frameP95: percentile(frameTimes, 0.95),
    oldestFocus,
    baseVisibleP50: percentile(baseVisible, 0.5),
    baseVisibleP95: percentile(baseVisible, 0.95),
    baseVisibleMax: Math.max(...baseVisible, 0),
    sceneBacklog,
    expandedPeak,
    memoryPeak,
    maximumTarget: adaptive.diagnostics.maximumTarget,
    targetTransitions: mode.startsWith("adaptive-")
      ? `${adaptive.diagnostics.scaleUpTransitions} up / ${adaptive.diagnostics.scaleDownTransitions} down`
      : "fixed",
    completionIdentity:
      completionIds.length === jobs.length &&
      new Set(completionIds).size === jobs.length
        ? "all base records once"
        : "incomplete or duplicate",
  };
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}
