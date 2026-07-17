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

test("adaptive target scales one at a time after sustain and cooldown", () => {
  const profile = selectVoxelWorkerProfile({
    coarsePointer: false,
    deviceMemoryGb: 8,
  });
  let state = createVoxelAdaptiveState(profile, 0);
  state = updateVoxelAdaptiveTarget(state, healthySample(0), profile);
  state = updateVoxelAdaptiveTarget(state, healthySample(1_500), profile);
  assert.equal(state.targetWorkers, 2);
  state = updateVoxelAdaptiveTarget(state, healthySample(3_000), profile);
  assert.equal(state.targetWorkers, 3);
  state = updateVoxelAdaptiveTarget(state, healthySample(6_000), profile);
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
    oldestUrgentQueueMs: 1_000,
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
