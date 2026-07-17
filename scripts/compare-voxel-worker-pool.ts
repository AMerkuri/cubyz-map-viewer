import {
  createVoxelAdaptiveState,
  selectVoxelWorkerProfile,
  updateVoxelAdaptiveTarget,
} from "../src/client/features/world-view/lib/voxel-adaptive-workers.js";

interface SyntheticJob {
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
const MODES = ["fixed-1", "fixed-2", "fixed-4", "adaptive"] as const;
const CAMERA_WORKLOADS = [
  { name: "spawn-overview", jobs: 32, duration: 120, bytes: 2.5 * 1024 ** 2 },
  { name: "settled-focus", jobs: 24, duration: 210, bytes: 4.5 * 1024 ** 2 },
  { name: "ridge-pan", jobs: 40, duration: 150, bytes: 3.25 * 1024 ** 2 },
] as const;

const jobs = CAMERA_WORKLOADS.flatMap((camera, cameraIndex) =>
  Array.from({ length: camera.jobs }, (_, index) => ({
    camera: camera.name,
    releaseAt: cameraIndex * 2_000 + index * 40,
    durationMs: camera.duration + ((index * 29) % 90),
    bytes: Math.round(camera.bytes + ((index * 104_729) % (1.5 * 1024 ** 2))),
    focus: index % 3 === 0,
  })),
);

console.log(
  "| Class | Mode | Frame p95 (ms) | Oldest focus (ms) | Base-visible p95 (ms) | Scene backlog max | Expanded peak (MiB) | Memory estimate peak (MiB) |",
);
console.log("|---|---:|---:|---:|---:|---:|---:|---:|");
for (const deviceClass of ["desktop", "mobile"] as const) {
  for (const mode of MODES) {
    const result = simulate(deviceClass, mode);
    console.log(
      `| ${deviceClass} | ${mode} | ${result.frameP95.toFixed(1)} | ${result.oldestFocus.toFixed(0)} | ${result.baseVisibleP95.toFixed(0)} | ${result.sceneBacklog} | ${toMiB(result.expandedPeak)} | ${toMiB(result.memoryPeak)} |`,
    );
  }
}

function simulate(
  deviceClass: "desktop" | "mobile",
  mode: (typeof MODES)[number],
) {
  const profile = selectVoxelWorkerProfile({
    coarsePointer: deviceClass === "mobile",
    deviceMemoryGb: deviceClass === "mobile" ? 4 : 8,
  });
  let adaptive = createVoxelAdaptiveState(profile);
  const queue: SyntheticJob[] = [];
  const active: ActiveJob[] = [];
  const scene: Array<SyntheticJob & { completedAt: number }> = [];
  const frameTimes: number[] = [];
  const baseVisible: number[] = [];
  let nextJob = 0;
  let loadedBytes = 0;
  let oldestFocus = 0;
  let sceneBacklog = 0;
  let expandedPeak = 0;
  let memoryPeak = 0;
  const endAt = Math.max(...jobs.map((job) => job.releaseAt)) + 12_000;

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

    const fixedTarget = mode === "adaptive" ? null : Number(mode.at(-1));
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
      (deviceClass === "mobile" ? 13 : 9) +
      completions * (deviceClass === "mobile" ? 2.2 : 1.2) +
      (inserted ? inserted.bytes / (4 * 1024 ** 2) : 0);
    frameTimes.push(frameTime);

    if (mode === "adaptive") {
      adaptive = updateVoxelAdaptiveTarget(
        adaptive,
        {
          now,
          oldestUrgentQueueMs: Math.max(...currentFocusAges, 0),
          frameTimeMs: frameTime,
          workerBusyRatio: active.length / Math.max(1, adaptive.targetWorkers),
          workerDurationMs: active.reduce(
            (max, job) => Math.max(max, job.durationMs),
            0,
          ),
          sceneBacklogJobs: scene.length,
          sceneBacklogBytes: scene.reduce((sum, job) => sum + job.bytes, 0),
          reservedBytes: active.reduce((sum, job) => sum + job.reservation, 0),
          expandedBytes: currentExpanded,
          memoryPressure:
            memoryPeak / (deviceClass === "mobile" ? 384 : 1024) / 1024 ** 2,
          interacting:
            (now >= 4_000 && now < 4_500) || (now >= 5_000 && now < 5_300),
        },
        profile,
      );
    }
  }

  return {
    frameP95: percentile(frameTimes, 0.95),
    oldestFocus,
    baseVisibleP95: percentile(baseVisible, 0.95),
    sceneBacklog,
    expandedPeak,
    memoryPeak,
  };
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

function toMiB(bytes: number): string {
  return (bytes / 1024 ** 2).toFixed(1);
}
