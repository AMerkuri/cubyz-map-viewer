import assert from "node:assert/strict";
import { test } from "node:test";
import type { PendingVoxelFetchRequest } from "../../../src/client/features/world-view/lib/types.js";
import {
  drainVoxelFetchQueue,
  requestDirectVoxelRefresh,
} from "../../../src/client/features/world-view/lib/voxel-runtime.js";
import {
  type VoxelWorkPriority,
  VoxelWorkScheduler,
} from "../../../src/client/features/world-view/lib/voxel-work.js";

function priority(projectedBenefit: number, generation = 1): VoxelWorkPriority {
  return {
    coverageClass: "detail",
    viewClass: "forward",
    projectedBenefit,
    distance: 100,
    lod: 1,
    generation,
  };
}

function request(key: string): PendingVoxelFetchRequest {
  return {
    key,
    lod: 1,
    regionX: 0,
    regionY: 0,
    priority: priority(1),
    generation: 1,
    version: 0,
    selectedAt: 0,
  };
}

test("burst fetch admission stops when compact input saturates", () => {
  const scheduler = new VoxelWorkScheduler<ArrayBuffer, Uint8Array>(
    { maxJobs: 1, maxBytes: 8 },
    { maxJobs: 1, maxBytes: 8 },
  );
  const pending = [request("a"), request("b"), request("c")];
  const active = new Set(pending.map((item) => item.key));
  const loading = new Set(active);
  const controllers = new Map<string, AbortController>();
  const activeFetches = { current: 0 };

  drainVoxelFetchQueue({
    pendingVoxelFetchQueueRef: { current: pending },
    activeVoxelFetchCountRef: activeFetches,
    maxConcurrentVoxelFetches: 3,
    activeVoxelRequestKeys: active,
    loadedVoxels: new Map(),
    isVoxelTileStale: () => false,
    missingVoxels: new Set(),
    failedVoxels: new Map(),
    maxVoxelRetries: 3,
    voxelFetchControllers: controllers,
    loadingVoxels: loading,
    canStartFetch: () => scheduler.canStartFetch(),
    fetchVoxelRegion: (item) => {
      const record = scheduler.createFetching({
        key: item.key,
        version: item.version,
        priority: priority(1),
        selectedAt: 0,
        fetchStartedAt: 0,
      });
      scheduler.acceptCompact(record.jobId, new ArrayBuffer(8), 8, 1);
    },
  });

  assert.equal(activeFetches.current, 1);
  assert.equal(pending.length, 2);
  assert.deepEqual(scheduler.snapshot().compactInput, { jobs: 1, bytes: 8 });
});

test("direct refresh waits in bounded fetch admission", () => {
  const pending: PendingVoxelFetchRequest[] = [];
  const pendingRef = { current: pending };
  const activeFetches = { current: 1 };
  const controllers = new Map([["1/0/0", new AbortController()]]);
  const loading = new Set<string>();
  let starts = 0;
  const drain = () =>
    drainVoxelFetchQueue({
      pendingVoxelFetchQueueRef: pendingRef,
      activeVoxelFetchCountRef: activeFetches,
      maxConcurrentVoxelFetches: 1,
      activeVoxelRequestKeys: new Set(),
      loadedVoxels: new Map([["1/0/0", {} as never]]),
      isVoxelTileStale: () => true,
      missingVoxels: new Set(),
      failedVoxels: new Map(),
      maxVoxelRetries: 3,
      voxelFetchControllers: controllers,
      loadingVoxels: loading,
      fetchVoxelRegion: () => {
        starts++;
      },
    });

  requestDirectVoxelRefresh({
    lod: 1,
    regionX: 0,
    regionY: 0,
    version: 2,
    failedVoxels: new Map(),
    maxVoxelRetries: 3,
    loadingVoxels: loading,
    queueVoxelFetchRequest: (item) => pending.push(item),
    drainVoxelFetchQueue: drain,
    activeVoxelRequestGeneration: 1,
  });

  assert.equal(starts, 0);
  assert.equal(pending.length, 1);
  controllers.clear();
  activeFetches.current = 0;
  drain();
  assert.equal(starts, 1);
  assert.equal(activeFetches.current, 1);
});

test("demand removal drops queued compact work", () => {
  const scheduler = new VoxelWorkScheduler<ArrayBuffer, Uint8Array>(
    { maxJobs: 2, maxBytes: 16 },
    { maxJobs: 2, maxBytes: 16 },
  );
  const record = scheduler.createFetching({
    key: "tile",
    version: 0,
    priority: priority(1),
    selectedAt: 0,
    fetchStartedAt: 0,
  });
  scheduler.acceptCompact(record.jobId, new ArrayBuffer(4), 4, 1);

  const cancelled = scheduler.cancelKey("tile", "demand-removed");

  assert.equal(cancelled[0]?.stage, "compact-input");
  assert.equal(scheduler.records.size, 0);
  assert.deepEqual(scheduler.snapshot().compactInput, { jobs: 0, bytes: 0 });
});

test("demand removal clears compatibility loading state for inserted work", () => {
  const scheduler = new VoxelWorkScheduler<ArrayBuffer, Uint8Array>(
    { maxJobs: 2, maxBytes: 16 },
    { maxJobs: 2, maxBytes: 16 },
  );
  const loading = new Set(["tile"]);
  const record = scheduler.createFetching({
    key: "tile",
    version: 0,
    priority: priority(1),
    selectedAt: 0,
    fetchStartedAt: 1,
  });
  scheduler.acceptCompact(record.jobId, new ArrayBuffer(1), 1, 2);
  scheduler.dispatchNext(3);
  scheduler.completeWorker(record.jobId, new Uint8Array(1), 1, {
    workerStartedAt: 3,
    workerCompletedAt: 4,
    resultReceivedAt: 5,
  });
  scheduler.markSceneInserted(record.jobId, 6);

  for (const cancelled of scheduler.cancelKey("tile", "demand-removed")) {
    loading.delete(cancelled.key);
  }

  assert.equal(loading.size, 0);
  assert.equal(scheduler.records.size, 0);
});

test("refresh supersession cancels old active work and rejects its result", () => {
  const scheduler = new VoxelWorkScheduler<ArrayBuffer, Uint8Array>(
    { maxJobs: 2, maxBytes: 16 },
    { maxJobs: 2, maxBytes: 16 },
  );
  const old = scheduler.createFetching({
    key: "tile",
    version: 1,
    priority: priority(1),
    selectedAt: 0,
    fetchStartedAt: 0,
  });
  scheduler.acceptCompact(old.jobId, new ArrayBuffer(4), 4, 1);
  scheduler.dispatchNext(2);

  const cancelled = scheduler.cancelKey("tile", "refresh-superseded", 2);

  assert.equal(cancelled[0]?.stage, "meshing");
  assert.equal(
    scheduler.completeWorker(old.jobId, new Uint8Array(4), 4, {
      workerStartedAt: 2,
      workerCompletedAt: 3,
      resultReceivedAt: 3,
    }),
    false,
  );
  assert.equal(scheduler.finish(old.jobId, "discarded"), true);
  assert.deepEqual(scheduler.snapshot().expandedOutput, { jobs: 0, bytes: 0 });
});

test("compact work dispatch uses its latest priority", () => {
  const scheduler = new VoxelWorkScheduler<ArrayBuffer, Uint8Array>(
    { maxJobs: 3, maxBytes: 24 },
    { maxJobs: 3, maxBytes: 24 },
  );
  const first = scheduler.createFetching({
    key: "first",
    version: 0,
    priority: priority(10),
    selectedAt: 0,
    fetchStartedAt: 0,
  });
  const second = scheduler.createFetching({
    key: "second",
    version: 0,
    priority: priority(1),
    selectedAt: 0,
    fetchStartedAt: 0,
  });
  scheduler.acceptCompact(first.jobId, new ArrayBuffer(4), 4, 1);
  scheduler.acceptCompact(second.jobId, new ArrayBuffer(4), 4, 1);
  scheduler.reprioritize(second.jobId, priority(20, 2));

  assert.equal(scheduler.dispatchNext(2)?.jobId, second.jobId);
});

test("worker failures release active capacity and continue draining", () => {
  const scheduler = new VoxelWorkScheduler<ArrayBuffer, Uint8Array>(
    { maxJobs: 3, maxBytes: 24 },
    { maxJobs: 1, maxBytes: 8 },
  );
  for (const key of ["first", "second"]) {
    const record = scheduler.createFetching({
      key,
      version: 0,
      priority: priority(key === "first" ? 2 : 1),
      selectedAt: 0,
      fetchStartedAt: 0,
    });
    scheduler.acceptCompact(record.jobId, new ArrayBuffer(4), 4, 1);
  }

  const failed = scheduler.dispatchNext(2);
  assert.ok(failed);
  assert.equal(scheduler.finish(failed.jobId, "error"), true);
  const next = scheduler.dispatchNext(3);

  assert.ok(next);
  assert.notEqual(next.jobId, failed.jobId);
  assert.deepEqual(scheduler.snapshot().activeWorker, { jobs: 1, bytes: 4 });
});
