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
  oldestUrgentQueueMs: number;
  frameTimeMs: number;
  workerBusyRatio: number;
  workerDurationMs: number;
  sceneBacklogJobs: number;
  sceneBacklogBytes: number;
  reservedBytes: number;
  expandedBytes: number;
  memoryPressure: number | null;
  interacting: boolean;
}

interface VoxelAdaptiveState {
  targetWorkers: number;
  lastTargetChangeAt: number;
  healthyDemandSince: number | null;
  samples: VoxelAdaptiveSample[];
}

interface VoxelAdaptiveConfig {
  sampleLimit: number;
  scaleUpSustainMs: number;
  scaleUpCooldownMs: number;
  urgentQueueMs: number;
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
  urgentQueueMs: 500,
  maxFrameP95Ms: 24,
  maxWorkerP95Ms: 2_000,
  maxSceneBacklogJobs: 3,
  maxSceneBytes: 72 * 1024 * 1024,
  maxReservedAndOutputBytes: 96 * 1024 * 1024,
  maxMemoryPressure: 0.82,
  minBusyRatio: 0.65,
};

export function createVoxelAdaptiveState(
  profile: VoxelWorkerProfile,
  now = 0,
): VoxelAdaptiveState {
  return {
    targetWorkers: profile.initialWorkers,
    lastTargetChangeAt: now,
    healthyDemandSince: null,
    samples: [],
  };
}

export function updateVoxelAdaptiveTarget(
  previous: VoxelAdaptiveState,
  sample: VoxelAdaptiveSample,
  profile: VoxelWorkerProfile,
  config: VoxelAdaptiveConfig = DEFAULT_VOXEL_ADAPTIVE_CONFIG,
): VoxelAdaptiveState {
  const samples = [...previous.samples, sample].slice(-config.sampleLimit);
  const frameP95 = percentile(
    samples.map((item) => item.frameTimeMs),
    0.95,
  );
  const workerP95 = percentile(
    samples.map((item) => item.workerDurationMs),
    0.95,
  );
  const unhealthy =
    sample.interacting ||
    frameP95 > config.maxFrameP95Ms ||
    workerP95 > config.maxWorkerP95Ms ||
    sample.sceneBacklogJobs > config.maxSceneBacklogJobs ||
    sample.sceneBacklogBytes > config.maxSceneBytes ||
    sample.reservedBytes + sample.expandedBytes >
      config.maxReservedAndOutputBytes ||
    (sample.memoryPressure !== null &&
      sample.memoryPressure > config.maxMemoryPressure);
  if (unhealthy) {
    const targetWorkers = Math.max(
      profile.minWorkers,
      sample.interacting ? profile.minWorkers : previous.targetWorkers - 1,
    );
    return {
      targetWorkers,
      lastTargetChangeAt:
        targetWorkers === previous.targetWorkers
          ? previous.lastTargetChangeAt
          : sample.now,
      healthyDemandSince: null,
      samples,
    };
  }

  const demandHealthy =
    sample.oldestUrgentQueueMs >= config.urgentQueueMs &&
    sample.workerBusyRatio >= config.minBusyRatio;
  const healthyDemandSince = demandHealthy
    ? (previous.healthyDemandSince ?? sample.now)
    : null;
  const canScaleUp =
    healthyDemandSince !== null &&
    sample.now - healthyDemandSince >= config.scaleUpSustainMs &&
    sample.now - previous.lastTargetChangeAt >= config.scaleUpCooldownMs &&
    previous.targetWorkers < profile.maxWorkers;
  return {
    targetWorkers: canScaleUp
      ? Math.min(profile.maxWorkers, previous.targetWorkers + 1)
      : previous.targetWorkers,
    lastTargetChangeAt: canScaleUp ? sample.now : previous.lastTargetChangeAt,
    healthyDemandSince: canScaleUp ? sample.now : healthyDemandSince,
    samples,
  };
}

function percentile(values: number[], fraction: number): number {
  const sorted = values
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}
