interface VoxelWorkerProfile {
  initialWorkers: number;
  minWorkers: number;
  maxWorkers: number;
  class: "desktop" | "mobile" | "low-memory" | "fallback" | "static-one";
}

export function selectVoxelWorkerProfile(input: {
  coarsePointer: boolean | null;
  deviceMemoryGb: number | null;
  staticOne?: boolean;
}): VoxelWorkerProfile {
  if (input.staticOne) {
    return {
      initialWorkers: 1,
      minWorkers: 1,
      maxWorkers: 1,
      class: "static-one",
    };
  }
  if (input.deviceMemoryGb !== null && input.deviceMemoryGb < 4) {
    return {
      initialWorkers: 1,
      minWorkers: 1,
      maxWorkers: 1,
      class: "low-memory",
    };
  }
  if (input.coarsePointer === null || input.deviceMemoryGb === null) {
    return {
      initialWorkers: 1,
      minWorkers: 1,
      maxWorkers: 2,
      class: "fallback",
    };
  }
  if (input.coarsePointer === false) {
    return {
      initialWorkers: 2,
      minWorkers: 1,
      maxWorkers: 4,
      class: "desktop",
    };
  }
  if (input.coarsePointer === true) {
    return { initialWorkers: 1, minWorkers: 1, maxWorkers: 2, class: "mobile" };
  }
  return { initialWorkers: 1, minWorkers: 1, maxWorkers: 2, class: "fallback" };
}

export interface VoxelAdaptiveSample {
  now: number;
  executableBaseJobs: number;
  oldestExecutableBaseAgeMs: number;
  frameTimeMs: number;
  workerBusyRatio: number;
  workerDurationMs?: number;
  sceneBacklogJobs: number;
  sceneBacklogBytes: number;
  reservedBytes: number;
  expandedBytes: number;
  memoryPressure: number | null;
  interacting: boolean;
}

export type VoxelAdaptiveLimiterReason =
  | "interaction"
  | "frame"
  | "worker"
  | "scene-jobs"
  | "scene-bytes"
  | "reservation"
  | "memory"
  | "sustain"
  | "cooldown"
  | "insufficient-demand"
  | "profile-maximum"
  | "healthy-demand";

export interface VoxelAdaptiveDiagnostics {
  initialTarget: number;
  maximumTarget: number;
  scaleUpTransitions: number;
  scaleDownTransitions: number;
  limiterObservations: Partial<Record<VoxelAdaptiveLimiterReason, number>>;
  peakExecutableBaseJobs: number;
  peakOldestExecutableBaseAgeMs: number;
  firstTransitionAt: number | null;
  latestTransitionAt: number | null;
}

interface VoxelAdaptiveState {
  targetWorkers: number;
  lastTargetChangeAt: number | null;
  healthyDemandSince: number | null;
  samples: VoxelAdaptiveSample[];
  workerDurations: number[];
  limiterReason: VoxelAdaptiveLimiterReason;
  diagnostics: VoxelAdaptiveDiagnostics;
}

interface VoxelAdaptiveConfig {
  sampleLimit: number;
  scaleUpSustainMs: number;
  scaleUpCooldownMs: number;
  basePressureAgeMs: number;
  maxFrameP95Ms: number;
  maxWorkerP95Ms: number;
  maxSceneBacklogJobs: number;
  maxSceneBytes: number;
  maxReservedAndOutputBytes: number;
  maxMemoryPressure: number;
  minBusyRatio: number;
}

const DEFAULT_VOXEL_ADAPTIVE_CONFIG: VoxelAdaptiveConfig = {
  sampleLimit: 60,
  scaleUpSustainMs: 1_500,
  scaleUpCooldownMs: 3_000,
  basePressureAgeMs: 500,
  maxFrameP95Ms: 24,
  maxWorkerP95Ms: 2_000,
  maxSceneBacklogJobs: 3,
  maxSceneBytes: 72 * 1024 * 1024,
  maxReservedAndOutputBytes: 256 * 1024 * 1024,
  maxMemoryPressure: 0.82,
  minBusyRatio: 0.65,
};

export function createVoxelAdaptiveState(
  profile: VoxelWorkerProfile,
  _now = 0,
): VoxelAdaptiveState {
  return {
    targetWorkers: profile.initialWorkers,
    lastTargetChangeAt: null,
    healthyDemandSince: null,
    samples: [],
    workerDurations: [],
    limiterReason: "insufficient-demand",
    diagnostics: {
      initialTarget: profile.initialWorkers,
      maximumTarget: profile.initialWorkers,
      scaleUpTransitions: 0,
      scaleDownTransitions: 0,
      limiterObservations: {},
      peakExecutableBaseJobs: 0,
      peakOldestExecutableBaseAgeMs: 0,
      firstTransitionAt: null,
      latestTransitionAt: null,
    },
  };
}

export function updateVoxelAdaptiveTarget(
  previous: VoxelAdaptiveState,
  sample: VoxelAdaptiveSample,
  profile: VoxelWorkerProfile,
  config: VoxelAdaptiveConfig = DEFAULT_VOXEL_ADAPTIVE_CONFIG,
): VoxelAdaptiveState {
  const samples = [...previous.samples, sample].slice(-config.sampleLimit);
  const workerDurations = Number.isFinite(sample.workerDurationMs)
    ? [...previous.workerDurations, sample.workerDurationMs ?? 0].slice(
        -config.sampleLimit,
      )
    : previous.workerDurations;
  const frameP95 = percentile(
    samples.map((item) => item.frameTimeMs),
    0.95,
  );
  const workerP95 = percentile(workerDurations, 0.95);
  const limiterReason = unhealthyLimiterReason(
    sample,
    frameP95,
    workerP95,
    config,
  );
  if (limiterReason !== null) {
    const targetWorkers = Math.max(
      profile.minWorkers,
      limiterReason === "interaction"
        ? profile.minWorkers
        : previous.targetWorkers - 1,
    );
    return withDecision(
      previous,
      {
        targetWorkers,
        lastTargetChangeAt:
          targetWorkers === previous.targetWorkers
            ? previous.lastTargetChangeAt
            : sample.now,
        healthyDemandSince: null,
        samples,
        workerDurations,
        limiterReason,
      },
      sample,
    );
  }

  const demandHealthy =
    sample.executableBaseJobs > previous.targetWorkers &&
    sample.oldestExecutableBaseAgeMs >= config.basePressureAgeMs &&
    sample.workerBusyRatio >= config.minBusyRatio;
  const healthyDemandSince = demandHealthy
    ? (previous.healthyDemandSince ?? sample.now)
    : null;
  const canScaleUp =
    healthyDemandSince !== null &&
    sample.now - healthyDemandSince >= config.scaleUpSustainMs &&
    (previous.lastTargetChangeAt === null ||
      sample.now - previous.lastTargetChangeAt >= config.scaleUpCooldownMs) &&
    previous.targetWorkers < profile.maxWorkers;
  const targetWorkers = canScaleUp
    ? Math.min(profile.maxWorkers, previous.targetWorkers + 1)
    : previous.targetWorkers;
  const reason: VoxelAdaptiveLimiterReason = canScaleUp
    ? "healthy-demand"
    : !demandHealthy
      ? "insufficient-demand"
      : previous.targetWorkers >= profile.maxWorkers
        ? "profile-maximum"
        : healthyDemandSince !== null &&
            sample.now - healthyDemandSince < config.scaleUpSustainMs
          ? "sustain"
          : "cooldown";
  return withDecision(
    previous,
    {
      targetWorkers,
      lastTargetChangeAt: canScaleUp ? sample.now : previous.lastTargetChangeAt,
      healthyDemandSince,
      samples,
      workerDurations,
      limiterReason: reason,
    },
    sample,
  );
}

function withDecision(
  previous: VoxelAdaptiveState,
  next: Omit<VoxelAdaptiveState, "diagnostics">,
  sample: VoxelAdaptiveSample,
): VoxelAdaptiveState {
  const transitioned = next.targetWorkers !== previous.targetWorkers;
  const limiterObservations = { ...previous.diagnostics.limiterObservations };
  limiterObservations[next.limiterReason] =
    (limiterObservations[next.limiterReason] ?? 0) + 1;
  return {
    ...next,
    diagnostics: {
      ...previous.diagnostics,
      maximumTarget: Math.max(
        previous.diagnostics.maximumTarget,
        next.targetWorkers,
      ),
      scaleUpTransitions:
        previous.diagnostics.scaleUpTransitions +
        Number(transitioned && next.targetWorkers > previous.targetWorkers),
      scaleDownTransitions:
        previous.diagnostics.scaleDownTransitions +
        Number(transitioned && next.targetWorkers < previous.targetWorkers),
      limiterObservations,
      peakExecutableBaseJobs: Math.max(
        previous.diagnostics.peakExecutableBaseJobs,
        sample.executableBaseJobs,
      ),
      peakOldestExecutableBaseAgeMs: Math.max(
        previous.diagnostics.peakOldestExecutableBaseAgeMs,
        sample.oldestExecutableBaseAgeMs,
      ),
      firstTransitionAt: transitioned
        ? (previous.diagnostics.firstTransitionAt ?? sample.now)
        : previous.diagnostics.firstTransitionAt,
      latestTransitionAt: transitioned
        ? sample.now
        : previous.diagnostics.latestTransitionAt,
    },
  };
}

function unhealthyLimiterReason(
  sample: VoxelAdaptiveSample,
  frameP95: number,
  workerP95: number,
  config: VoxelAdaptiveConfig,
): Exclude<
  VoxelAdaptiveLimiterReason,
  "cooldown" | "insufficient-demand" | "profile-maximum" | "healthy-demand"
> | null {
  if (sample.interacting) return "interaction";
  if (frameP95 > config.maxFrameP95Ms) return "frame";
  if (workerP95 > config.maxWorkerP95Ms) return "worker";
  if (sample.sceneBacklogJobs > config.maxSceneBacklogJobs) return "scene-jobs";
  if (sample.sceneBacklogBytes > config.maxSceneBytes) return "scene-bytes";
  if (
    sample.reservedBytes + sample.expandedBytes >
    config.maxReservedAndOutputBytes
  ) {
    return "reservation";
  }
  if (
    sample.memoryPressure !== null &&
    sample.memoryPressure > config.maxMemoryPressure
  ) {
    return "memory";
  }
  return null;
}

function percentile(values: number[], fraction: number): number {
  const sorted = values
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}
