import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createVoxelAdaptiveState,
  selectVoxelWorkerProfile,
  updateVoxelAdaptiveTarget,
  type VoxelAdaptiveSample,
} from "../../../src/client/features/world-view/lib/voxel-adaptive-workers.js";
import {
  type VoxelWorkPriority,
  VoxelWorkScheduler,
} from "../../../src/client/features/world-view/lib/voxel-work.js";
import { VoxelOutputEstimator } from "../../../src/client/features/world-view/lib/voxel-worker-capacity.js";
import {
  type VoxelWorkerLike,
  VoxelWorkerPool,
} from "../../../src/client/features/world-view/lib/voxel-worker-pool.js";

const basePriority: VoxelWorkPriority = {
  coverageClass: "detail",
  safetyClass: "optional",
  viewClass: "forward",
  phase: "base",
  projectedBenefit: 1,
  distance: 1,
  lod: 1,
  generation: 1,
  demandSince: 0,
  sequence: 1,
};

test("profiles use conservative explicit bounds and missing-hint fallback", () => {
  assert.deepEqual(
    selectVoxelWorkerProfile({ coarsePointer: false, deviceMemoryGb: 8 }),
    {
      initialWorkers: 2,
      minWorkers: 1,
      maxWorkers: 4,
      class: "desktop",
    },
  );
  assert.equal(
    selectVoxelWorkerProfile({ coarsePointer: true, deviceMemoryGb: 8 })
      .maxWorkers,
    2,
  );
  assert.equal(
    selectVoxelWorkerProfile({ coarsePointer: false, deviceMemoryGb: 2 })
      .maxWorkers,
    1,
  );
  assert.deepEqual(
    selectVoxelWorkerProfile({ coarsePointer: null, deviceMemoryGb: null }),
    {
      initialWorkers: 1,
      minWorkers: 1,
      maxWorkers: 2,
      class: "fallback",
    },
  );
  assert.equal(
    selectVoxelWorkerProfile({ coarsePointer: false, deviceMemoryGb: null })
      .class,
    "fallback",
  );
  assert.equal(
    selectVoxelWorkerProfile({ coarsePointer: null, deviceMemoryGb: 8 }).class,
    "fallback",
  );
  assert.equal(
    selectVoxelWorkerProfile({
      coarsePointer: false,
      deviceMemoryGb: 8,
      staticOne: true,
    }).maxWorkers,
    1,
  );
});

test("adaptive target scales after startup sustain and then honors transition cooldown", () => {
  const profile = {
    ...selectVoxelWorkerProfile({ coarsePointer: false, deviceMemoryGb: 8 }),
    initialWorkers: 1,
  };
  let state = createVoxelAdaptiveState(profile, 0);
  state = updateVoxelAdaptiveTarget(state, healthySample(0), profile);
  state = updateVoxelAdaptiveTarget(state, healthySample(1_500), profile);
  assert.equal(state.targetWorkers, 2);
  state = updateVoxelAdaptiveTarget(state, healthySample(3_000), profile);
  assert.equal(state.targetWorkers, 2);
  state = updateVoxelAdaptiveTarget(state, healthySample(4_500), profile);
  assert.equal(state.targetWorkers, 3);
  state = updateVoxelAdaptiveTarget(
    state,
    { ...healthySample(7_500), executableBaseJobs: 4 },
    profile,
  );
  assert.equal(state.targetWorkers, 4);
  assert.ok(state.samples.length <= 60);
});

test("adaptive target reduces promptly for frame and interaction pressure", () => {
  const profile = selectVoxelWorkerProfile({
    coarsePointer: false,
    deviceMemoryGb: 8,
  });
  let state = {
    ...createVoxelAdaptiveState(profile),
    targetWorkers: 4,
  };
  state = updateVoxelAdaptiveTarget(
    state,
    { ...healthySample(10), frameTimeMs: 40 },
    profile,
  );
  assert.equal(state.targetWorkers, 3);
  state = updateVoxelAdaptiveTarget(
    state,
    { ...healthySample(20), interacting: true },
    profile,
  );
  assert.equal(state.targetWorkers, 1);
});

test("fallback profile reaches two workers and reports stable limiter reasons", () => {
  const profile = selectVoxelWorkerProfile({
    coarsePointer: null,
    deviceMemoryGb: null,
  });
  let state = createVoxelAdaptiveState(profile, 0);
  state = updateVoxelAdaptiveTarget(state, healthySample(0), profile);
  state = updateVoxelAdaptiveTarget(state, healthySample(1_500), profile);
  assert.equal(state.targetWorkers, 2);
  assert.equal(state.limiterReason, "healthy-demand");
  state = updateVoxelAdaptiveTarget(
    state,
    { ...healthySample(3_100), frameTimeMs: 40, workerDurationMs: undefined },
    profile,
  );
  assert.equal(state.limiterReason, "frame");
});

test("ordinary executable detail sustains pressure while one record does not", () => {
  const profile = selectVoxelWorkerProfile({
    coarsePointer: null,
    deviceMemoryGb: null,
  });
  let state = createVoxelAdaptiveState(profile, 0);
  state = updateVoxelAdaptiveTarget(state, healthySample(0), profile);
  state = updateVoxelAdaptiveTarget(
    state,
    { ...healthySample(1_500), executableBaseJobs: 2 },
    profile,
  );
  assert.equal(state.targetWorkers, 2);

  state = createVoxelAdaptiveState(profile, 0);
  state = updateVoxelAdaptiveTarget(
    state,
    { ...healthySample(0), executableBaseJobs: 1 },
    profile,
  );
  state = updateVoxelAdaptiveTarget(
    state,
    { ...healthySample(10_000), executableBaseJobs: 1 },
    profile,
  );
  assert.equal(state.targetWorkers, 1);
  assert.equal(state.limiterReason, "insufficient-demand");
});

test("adaptive diagnostics retain transitions and limiter blockers", () => {
  const profile = selectVoxelWorkerProfile({
    coarsePointer: null,
    deviceMemoryGb: null,
  });
  let state = createVoxelAdaptiveState(profile, 0);
  state = updateVoxelAdaptiveTarget(state, healthySample(0), profile);
  state = updateVoxelAdaptiveTarget(state, healthySample(1_500), profile);
  state = updateVoxelAdaptiveTarget(
    state,
    { ...healthySample(2_000), executableBaseJobs: 0 },
    profile,
  );
  assert.equal(state.limiterReason, "insufficient-demand");
  assert.equal(state.diagnostics.maximumTarget, 2);
  assert.equal(state.diagnostics.scaleUpTransitions, 1);
  assert.ok((state.diagnostics.limiterObservations["healthy-demand"] ?? 0) > 0);
  assert.ok(
    (state.diagnostics.limiterObservations["insufficient-demand"] ?? 0) > 0,
  );
});

test("each unhealthy limiter prevents scale-up and reduces the target", () => {
  const profile = selectVoxelWorkerProfile({
    coarsePointer: false,
    deviceMemoryGb: 8,
  });
  const unhealthySamples: Array<[string, Partial<VoxelAdaptiveSample>]> = [
    ["interaction", { interacting: true }],
    ["frame", { frameTimeMs: 40 }],
    ["worker", { workerDurationMs: 2_500 }],
    ["scene-jobs", { sceneBacklogJobs: 4 }],
    ["scene-bytes", { sceneBacklogBytes: 73 * 1024 * 1024 }],
    ["reservation", { reservedBytes: 257 * 1024 * 1024, expandedBytes: 0 }],
    ["memory", { memoryPressure: 0.9 }],
  ];
  for (const [reason, overrides] of unhealthySamples) {
    const state = updateVoxelAdaptiveTarget(
      { ...createVoxelAdaptiveState(profile), targetWorkers: 2 },
      { ...healthySample(10), ...overrides },
      profile,
    );
    assert.equal(state.targetWorkers, 1, reason);
    assert.equal(state.limiterReason, reason);
  }
});

test("expanded reservations contain underestimated active output overshoot", () => {
  const scheduler = new VoxelWorkScheduler<ArrayBuffer, Uint8Array>(
    { maxJobs: 4, maxBytes: 100 },
    { maxJobs: 3, maxBytes: 10 },
  );
  const records = [1, 2, 3].map((sequence) => {
    const record = scheduler.createFetching({
      key: `tile-${sequence}`,
      version: 1,
      priority: { ...basePriority, sequence },
      selectedAt: 0,
      fetchStartedAt: 0,
    });
    scheduler.acceptCompact(record.jobId, new ArrayBuffer(1), 1, 1);
    return record;
  });
  assert.equal(scheduler.dispatchNext(2, 1, 4)?.jobId, records[0]?.jobId);
  assert.equal(scheduler.dispatchNext(2, 2, 4)?.jobId, records[1]?.jobId);
  scheduler.completeWorker(records[0]?.jobId ?? -1, new Uint8Array(12), 12, {
    workerStartedAt: 2,
    workerCompletedAt: 3,
    resultReceivedAt: 4,
  });
  assert.equal(scheduler.dispatchNext(5, 1, 1), null);
  assert.deepEqual(scheduler.snapshot().expandedOutput, { jobs: 1, bytes: 12 });
  assert.deepEqual(scheduler.snapshot().reservedExpandedOutput, {
    jobs: 1,
    bytes: 4,
  });
});

test("one oversized reservation progresses only while output stage is empty", () => {
  const scheduler = new VoxelWorkScheduler<ArrayBuffer, Uint8Array>(
    { maxJobs: 2, maxBytes: 100 },
    { maxJobs: 2, maxBytes: 10 },
  );
  for (const sequence of [1, 2]) {
    const record = scheduler.createFetching({
      key: `oversized-${sequence}`,
      version: 1,
      priority: { ...basePriority, sequence },
      selectedAt: 0,
      fetchStartedAt: 0,
    });
    scheduler.acceptCompact(record.jobId, new ArrayBuffer(1), 1, 1);
  }
  assert.ok(scheduler.dispatchNext(2, 1, 20));
  assert.equal(scheduler.dispatchNext(2, 2, 1), null);
});

test("output estimator uses compact quad metadata and bounded LOD history", () => {
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  view.setUint32(0, 0x364d5856, true);
  view.setUint32(16, 100, true);
  const estimator = new VoxelOutputEstimator(2);
  const metadataEstimate = estimator.estimate({
    phase: "base",
    lod: 1,
    buffer,
  });
  assert.ok(metadataEstimate > 80_000);
  estimator.observeActual("base", 1, buffer.byteLength, 1_000_000);
  assert.ok(estimator.estimate({ phase: "base", lod: 1, buffer }) >= 1_000_000);
  assert.ok(
    estimator.estimate({ phase: "enhancement", lod: 1, buffer }) < 1_000_000,
  );
});

test("output estimates learn independently by phase and LOD after bootstrap", () => {
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  view.setUint32(0, 0x364d5856, true);
  view.setUint32(16, 100, true);
  const estimator = new VoxelOutputEstimator(4);
  const baseBootstrap = estimator.estimate({ phase: "base", lod: 1, buffer });
  const enhancementBootstrap = estimator.estimate({
    phase: "enhancement",
    lod: 1,
    buffer,
  });
  assert.ok(baseBootstrap > enhancementBootstrap);

  estimator.observeActual("base", 1, buffer.byteLength, 1_000_000);
  estimator.observeActual("enhancement", 1, buffer.byteLength, 40_000);
  estimator.observeActual("base", 4, buffer.byteLength, 120_000);
  const learnedBase = estimator.estimate({ phase: "base", lod: 1, buffer });
  const learnedEnhancement = estimator.estimate({
    phase: "enhancement",
    lod: 1,
    buffer,
  });
  assert.ok(learnedBase >= 1_250_000);
  assert.ok(learnedEnhancement >= 50_000);
  assert.ok(
    estimator.estimate({ phase: "base", lod: 4, buffer }) < learnedBase,
  );

  // A dense LOD 1 result raises only its own conservative learned estimate.
  estimator.observeActual("base", 1, buffer.byteLength, 4_000_000);
  assert.ok(estimator.estimate({ phase: "base", lod: 1, buffer }) >= 1_250_000);
  assert.ok(
    estimator.estimate({ phase: "enhancement", lod: 1, buffer }) < 100_000,
  );
});

test("rolling controller observations recover after stale worker and frame outliers", () => {
  const profile = selectVoxelWorkerProfile({
    coarsePointer: null,
    deviceMemoryGb: null,
  });
  const config = {
    sampleLimit: 2,
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
  let state = createVoxelAdaptiveState(profile, 0);
  state = updateVoxelAdaptiveTarget(
    state,
    { ...healthySample(0), frameTimeMs: 40, workerDurationMs: 2_500 },
    profile,
    config,
  );
  assert.equal(state.limiterReason, "frame");
  state = updateVoxelAdaptiveTarget(
    state,
    healthySample(1_000),
    profile,
    config,
  );
  state = updateVoxelAdaptiveTarget(
    state,
    healthySample(2_500),
    profile,
    config,
  );
  state = updateVoxelAdaptiveTarget(
    state,
    healthySample(4_000),
    profile,
    config,
  );
  assert.equal(state.targetWorkers, 2);
  assert.equal(state.limiterReason, "healthy-demand");
});

test("low-memory and static-one profiles never scale past their safe cap", () => {
  for (const profile of [
    selectVoxelWorkerProfile({ coarsePointer: false, deviceMemoryGb: 2 }),
    selectVoxelWorkerProfile({
      coarsePointer: false,
      deviceMemoryGb: 8,
      staticOne: true,
    }),
  ]) {
    let state = createVoxelAdaptiveState(profile, 0);
    state = updateVoxelAdaptiveTarget(state, healthySample(0), profile);
    state = updateVoxelAdaptiveTarget(state, healthySample(10_000), profile);
    assert.equal(state.targetWorkers, 1);
    assert.equal(state.limiterReason, "profile-maximum");
  }
});

test("worker failure replaces its ID and releases callback ownership", () => {
  const workers: FakeWorker[] = [];
  const errors: number[] = [];
  const pool = new VoxelWorkerPool<string>({
    initialWorkers: 2,
    maxWorkers: 2,
    createWorker: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
    onMessage: () => {},
    onError: (workerId) => errors.push(workerId),
  });
  pool.dispatchToIdle(() => true);
  workers[0]?.fail();
  assert.deepEqual(errors, [1]);
  assert.equal(pool.activeCount, 2);
  assert.deepEqual(
    pool.snapshot().map((slot) => slot.id),
    [2, 3],
  );
  assert.equal(workers[0]?.terminated, true);
  pool.shutdown();
});

test("scale-down retires excess workers only when they become idle", () => {
  const pool = createFakePool(2, 2);
  pool.dispatchToIdle(() => true);
  pool.setTarget(1);
  assert.equal(pool.activeCount, 2);
  assert.equal(pool.complete(2), true);
  assert.equal(pool.activeCount, 1);
  assert.equal(pool.targetCount, 1);
  pool.shutdown();
});

test("static one-worker pool preserves sequential fallback dispatch", () => {
  const pool = createFakePool(1, 1);
  let dispatched = 0;
  assert.equal(
    pool.dispatchToIdle(() => {
      dispatched++;
      return true;
    }),
    1,
  );
  assert.equal(
    pool.dispatchToIdle(() => true),
    0,
  );
  assert.equal(pool.complete(1), true);
  assert.equal(
    pool.dispatchToIdle(() => true),
    1,
  );
  assert.equal(dispatched, 1);
  pool.shutdown();
});

function healthySample(now: number): VoxelAdaptiveSample {
  return {
    now,
    executableBaseJobs: 3,
    oldestExecutableBaseAgeMs: 1_000,
    frameTimeMs: 12,
    workerBusyRatio: 1,
    workerDurationMs: 100,
    sceneBacklogJobs: 0,
    sceneBacklogBytes: 0,
    reservedBytes: 0,
    expandedBytes: 0,
    memoryPressure: 0.5,
    interacting: false,
  };
}

function createFakePool(initialWorkers: number, maxWorkers: number) {
  return new VoxelWorkerPool<string>({
    initialWorkers,
    maxWorkers,
    createWorker: () => new FakeWorker(),
    onMessage: () => {},
    onError: () => {},
  });
}

class FakeWorker implements VoxelWorkerLike {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;

  postMessage(): void {}

  terminate(): void {
    this.terminated = true;
  }

  fail(): void {
    this.onerror?.({} as ErrorEvent);
  }
}
