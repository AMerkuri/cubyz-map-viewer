import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import type { PendingVoxelFetchRequest } from "../../../src/client/features/world-view/lib/types.js";
import { attachVoxelEmissiveEnhancement } from "../../../src/client/features/world-view/lib/voxel-builders.js";
import {
  drainVoxelFetchQueue,
  isVoxelEnhancementTargetValid,
  requestDirectVoxelRefresh,
} from "../../../src/client/features/world-view/lib/voxel-runtime.js";
import {
  type VoxelWorkPriority,
  VoxelWorkScheduler,
} from "../../../src/client/features/world-view/lib/voxel-work.js";

function priority(projectedBenefit: number, generation = 1): VoxelWorkPriority {
  return {
    coverageClass: "detail",
    safetyClass: "optional",
    viewClass: "forward",
    phase: "base",
    projectedBenefit,
    distance: 100,
    lod: 1,
    generation,
    demandSince: 0,
    sequence: generation,
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

test("one and two worker completion orders converge the same lifecycle identities", () => {
  const replay = (workerCount: number, completionOrder: string[]) => {
    const scheduler = new VoxelWorkScheduler<ArrayBuffer, Uint8Array>(
      { maxJobs: 8, maxBytes: 64 },
      { maxJobs: 8, maxBytes: 64 },
    );
    const demands = new Map(
      ["first", "second", "refresh"].map((key, sequence) => [
        key,
        { key, version: 1, priority: { ...priority(3 - sequence), sequence } },
      ]),
    );
    scheduler.reconcileDemand(demands, 0);
    const records = new Map<string, number>();
    for (const demand of demands.values()) {
      scheduler.markFetchQueued(demand.key, demand.version);
      const record = scheduler.createFetching({
        ...demand,
        selectedAt: 0,
        fetchStartedAt: 1,
      });
      scheduler.acceptCompact(record.jobId, new ArrayBuffer(1), 1, 2);
      records.set(demand.key, record.jobId);
    }
    const originalRefresh = records.get("refresh");
    assert.ok(originalRefresh);
    scheduler.cancel(originalRefresh, "refresh-superseded");
    scheduler.finish(originalRefresh, "discarded", "refresh-superseded");
    const refreshed = { key: "refresh", version: 2, priority: priority(3, 2) };
    scheduler.reconcileDemand(new Map([...demands, ["refresh", refreshed]]), 3);
    const refreshRecord = scheduler.createFetching({
      ...refreshed,
      selectedAt: 3,
      fetchStartedAt: 4,
    });
    scheduler.acceptCompact(refreshRecord.jobId, new ArrayBuffer(1), 1, 5);
    records.set("refresh", refreshRecord.jobId);

    const loaded = new Set<string>();
    let now = 6;
    for (const _key of completionOrder) {
      const dispatched = scheduler.dispatchNext(now, (now % workerCount) + 1);
      assert.ok(dispatched);
      scheduler.completeWorker(dispatched.jobId, new Uint8Array(1), 1, {
        workerStartedAt: now,
        workerCompletedAt: now + 1,
        resultReceivedAt: now + 2,
      });
      scheduler.markSceneInserted(dispatched.jobId, now + 3);
      scheduler.markFirstVisible(dispatched.jobId, now + 4);
      loaded.add(dispatched.key);
      now += 5;
    }
    scheduler.reconcileDemand(
      new Map([
        [
          "missing",
          {
            key: "missing",
            version: 1,
            priority: priority(1),
            demandState: "known-missing" as const,
          },
        ],
        [
          "delayed",
          {
            key: "delayed",
            version: 1,
            priority: priority(1),
            demandState: "retry-delayed" as const,
          },
        ],
      ]),
      now,
    );
    return {
      loaded: [...loaded].sort(),
      diagnostics:
        scheduler.getDiagnostics(now).currentQueue.nonExecutableDemand,
      invariant: scheduler.assertProgressInvariant(),
    };
  };

  const sequential = replay(1, ["first", "second", "refresh"]);
  const concurrent = replay(2, ["second", "refresh", "first"]);
  assert.deepEqual(concurrent.loaded, sequential.loaded);
  assert.deepEqual(concurrent.diagnostics, sequential.diagnostics);
  assert.deepEqual(sequential.invariant, []);
  assert.deepEqual(concurrent.invariant, []);
});

test("LOD reconciliation during cancellation leaves each requestable key owned", () => {
  const scheduler = new VoxelWorkScheduler<ArrayBuffer, Uint8Array>(
    { maxJobs: 4, maxBytes: 16 },
    { maxJobs: 4, maxBytes: 16 },
  );
  const first = { key: "lod-1", version: 1, priority: priority(2) };
  const retained = { key: "lod-4", version: 1, priority: priority(1) };
  scheduler.reconcileDemand(
    new Map([
      [first.key, first],
      [retained.key, retained],
    ]),
    0,
  );
  const active = scheduler.createFetching({
    ...first,
    selectedAt: 0,
    fetchStartedAt: 1,
  });
  scheduler.acceptCompact(active.jobId, new ArrayBuffer(1), 1, 2);
  scheduler.dispatchNext(3, 1);
  scheduler.cancel(active.jobId, "demand-removed");

  const replacement = { key: "lod-2", version: 1, priority: priority(3) };
  scheduler.reconcileDemand(
    new Map([
      [retained.key, retained],
      [replacement.key, replacement],
    ]),
    4,
  );
  assert.deepEqual(scheduler.assertProgressInvariant(), []);
  assert.equal(scheduler.getByKey(replacement.key)[0]?.stage, "selected");
  assert.equal(scheduler.getByKey(retained.key)[0]?.stage, "selected");
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

test("urgent base dispatches before retained enhancement", () => {
  const scheduler = new VoxelWorkScheduler<ArrayBuffer, Uint8Array>(
    { maxJobs: 3, maxBytes: 24 },
    { maxJobs: 3, maxBytes: 24 },
  );
  const enhancement = scheduler.createRetainedEnhancement({
    key: "enhancement",
    version: 0,
    priority: priority(1),
    selectedAt: 0,
    retainedAt: 1,
    compact: new ArrayBuffer(4),
    compactBytes: 4,
    baseMeshId: 7,
  });
  const base = scheduler.createFetching({
    key: "base",
    version: 0,
    priority: priority(1),
    selectedAt: 0,
    fetchStartedAt: 0,
  });
  scheduler.acceptCompact(base.jobId, new ArrayBuffer(4), 4, 1);

  assert.equal(scheduler.dispatchNext(2)?.jobId, base.jobId);
  assert.equal(enhancement.stage, "retained-enhancement-input");
});

test("enhancement cancellation releases retained and active ownership exactly once", () => {
  const scheduler = new VoxelWorkScheduler<ArrayBuffer, Uint8Array>(
    { maxJobs: 3, maxBytes: 24 },
    { maxJobs: 3, maxBytes: 24 },
  );
  const queued = scheduler.createRetainedEnhancement({
    key: "queued",
    version: 0,
    priority: priority(1),
    selectedAt: 0,
    retainedAt: 1,
    compact: new ArrayBuffer(5),
    compactBytes: 5,
    baseMeshId: 1,
  });
  scheduler.cancelKey("queued", "demand-removed");
  assert.equal(scheduler.finish(queued.jobId, "cancelled"), false);
  assert.deepEqual(scheduler.snapshot().compactInput, { jobs: 0, bytes: 0 });

  const active = scheduler.createRetainedEnhancement({
    key: "active",
    version: 0,
    priority: priority(1),
    selectedAt: 0,
    retainedAt: 1,
    compact: new ArrayBuffer(6),
    compactBytes: 6,
    baseMeshId: 2,
  });
  scheduler.dispatchNext(2, 0, 12);
  scheduler.cancelKey("active", "demand-removed");
  assert.equal(
    scheduler.completeWorker(active.jobId, new Uint8Array(3), 3, {
      workerStartedAt: 2,
      workerCompletedAt: 3,
      resultReceivedAt: 4,
    }),
    false,
  );
  assert.equal(
    scheduler.finish(active.jobId, "discarded", "cancel-race"),
    true,
  );
  assert.equal(scheduler.finish(active.jobId, "discarded"), false);
  assert.deepEqual(scheduler.snapshot().reservedExpandedOutput, {
    jobs: 0,
    bytes: 0,
  });
});

test("target invalidation cancels only its enhancement job", () => {
  const scheduler = new VoxelWorkScheduler<ArrayBuffer, Uint8Array>(
    { maxJobs: 3, maxBytes: 24 },
    { maxJobs: 3, maxBytes: 24 },
  );
  const base = scheduler.createFetching({
    key: "tile",
    version: 0,
    priority: priority(1),
    selectedAt: 0,
    fetchStartedAt: 0,
  });
  scheduler.acceptCompact(base.jobId, new ArrayBuffer(4), 4, 1);
  scheduler.dispatchNext(2);
  scheduler.completeWorker(base.jobId, new Uint8Array(1), 1, {
    workerStartedAt: 2,
    workerCompletedAt: 3,
    resultReceivedAt: 4,
  });
  scheduler.markSceneInserted(base.jobId, 5);
  const enhancement = scheduler.createRetainedEnhancement({
    key: "tile",
    version: 0,
    priority: priority(1),
    selectedAt: 0,
    retainedAt: 5,
    compact: new ArrayBuffer(4),
    compactBytes: 4,
    baseMeshId: 9,
  });

  scheduler.cancel(enhancement.jobId, "demand-removed");

  assert.equal(scheduler.records.get(base.jobId)?.stage, "inserted");
  assert.equal(scheduler.records.has(enhancement.jobId), false);
  assert.deepEqual(scheduler.snapshot().compactInput, { jobs: 0, bytes: 0 });
});

test("enhancement completion records independent timings and releases output", () => {
  const scheduler = new VoxelWorkScheduler<ArrayBuffer, Uint8Array>(
    { maxJobs: 2, maxBytes: 16 },
    { maxJobs: 2, maxBytes: 16 },
  );
  const enhancement = scheduler.createRetainedEnhancement({
    key: "tile",
    version: 1,
    priority: priority(1),
    selectedAt: 0,
    retainedAt: 10,
    compact: new ArrayBuffer(4),
    compactBytes: 4,
    baseMeshId: 3,
  });
  scheduler.dispatchNext(15);
  scheduler.completeWorker(enhancement.jobId, new Uint8Array(3), 3, {
    workerStartedAt: 16,
    workerCompletedAt: 20,
    resultReceivedAt: 22,
  });
  assert.equal(scheduler.markEnhancementAttached(enhancement.jobId, 25), true);

  const timings = scheduler.getDiagnostics(25).timings;
  assert.equal(timings.enhancementQueueWaitMs.p50Ms, 5);
  assert.equal(timings.enhancementWorkerExecutionMs.p50Ms, 4);
  assert.equal(timings.enhancementResultTransferWaitMs.p50Ms, 2);
  assert.equal(timings.enhancementAttachWaitMs.p50Ms, 3);
  assert.equal(timings.selectionToEnhancedMs.p50Ms, 25);
  assert.deepEqual(scheduler.snapshot().expandedOutput, { jobs: 0, bytes: 0 });
});

test("fresh base retains progressive enhancement through request reconciliation", () => {
  const scheduler = new VoxelWorkScheduler<ArrayBuffer, Uint8Array>(
    { maxJobs: 2, maxBytes: 16 },
    { maxJobs: 2, maxBytes: 16 },
  );
  const base = scheduler.createFetching({
    key: "tile",
    version: 3,
    priority: priority(1),
    selectedAt: 0,
    fetchStartedAt: 0,
  });
  scheduler.acceptCompact(base.jobId, new ArrayBuffer(4), 4, 1);
  scheduler.dispatchNext(2);
  scheduler.completeWorker(base.jobId, new Uint8Array(1), 1, {
    workerStartedAt: 2,
    workerCompletedAt: 3,
    resultReceivedAt: 4,
  });
  scheduler.markSceneInserted(base.jobId, 5);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(12), 3),
  );
  const baseMeshId = 9;
  const tile = {
    baseMeshId,
    subMeshes: [{ quadrantIndex: 0, mesh: new THREE.Mesh(geometry) }],
  } as never;
  const enhancement = scheduler.createRetainedEnhancement({
    key: "tile",
    version: 3,
    priority: priority(1),
    selectedAt: 0,
    retainedAt: 5,
    compact: new ArrayBuffer(4),
    compactBytes: 4,
    baseMeshId,
  });

  // Base insertion makes the tile fresh, so normal reconciliation clears fetch demand.
  scheduler.reconcileDemand(new Map(), 6);
  scheduler.cancel(base.jobId, "demand-removed");
  assert.equal(scheduler.records.has(enhancement.jobId), true);
  assert.equal(
    isVoxelEnhancementTargetValid({
      currentRefreshVersion: 3,
      targetRefreshVersion: enhancement.version,
      stale: false,
      loadedBaseMeshId: baseMeshId,
      targetBaseMeshId: baseMeshId,
      scheduledBaseMeshId: enhancement.baseMeshId,
    }),
    true,
  );

  scheduler.dispatchNext(7);
  scheduler.completeWorker(
    enhancement.jobId,
    new Uint8Array(12).fill(127),
    12,
    {
      workerStartedAt: 7,
      workerCompletedAt: 8,
      resultReceivedAt: 9,
    },
  );
  assert.equal(
    attachVoxelEmissiveEnhancement(tile, [
      { quadrantIndex: 0, emissiveColors: new Uint8Array(12).fill(127) },
    ]),
    true,
  );
  assert.equal(scheduler.markEnhancementAttached(enhancement.jobId, 10), true);
  assert.equal(geometry.getAttribute("emissiveLight").normalized, true);
  assert.deepEqual(scheduler.snapshot().compactInput, { jobs: 0, bytes: 0 });
  assert.deepEqual(scheduler.snapshot().expandedOutput, { jobs: 0, bytes: 0 });
});

test("enhancement target validation rejects every lifecycle mismatch", () => {
  const valid = {
    currentRefreshVersion: 3,
    targetRefreshVersion: 3,
    stale: false,
    loadedBaseMeshId: 9,
    targetBaseMeshId: 9,
    scheduledBaseMeshId: 9,
  };
  assert.equal(isVoxelEnhancementTargetValid(valid), true);
  for (const mismatch of [
    { currentRefreshVersion: 4 },
    { stale: true },
    { loadedBaseMeshId: null },
    { loadedBaseMeshId: 10 },
    { targetBaseMeshId: 10 },
    { scheduledBaseMeshId: 10 },
  ]) {
    assert.equal(
      isVoxelEnhancementTargetValid({ ...valid, ...mismatch }),
      false,
    );
  }
});

test("invalidated enhancement cannot mutate target or unrelated geometry", () => {
  const targetGeometry = new THREE.BufferGeometry();
  targetGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(12), 3),
  );
  const unrelatedGeometry = new THREE.BufferGeometry();
  unrelatedGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(12), 3),
  );
  const targetBaseMeshId = 9;
  const target = {
    baseMeshId: targetBaseMeshId,
    subMeshes: [{ quadrantIndex: 0, mesh: new THREE.Mesh(targetGeometry) }],
  } as never;
  const valid = {
    currentRefreshVersion: 3,
    targetRefreshVersion: 3,
    stale: false,
    loadedBaseMeshId: targetBaseMeshId,
    targetBaseMeshId,
    scheduledBaseMeshId: targetBaseMeshId,
  };

  for (const invalidation of [
    { loadedBaseMeshId: null }, // Unloaded or moved to the warm cache.
    { currentRefreshVersion: 4 }, // Refresh superseded.
    { stale: true },
    { loadedBaseMeshId: 10 }, // Base geometry was replaced.
  ]) {
    if (isVoxelEnhancementTargetValid({ ...valid, ...invalidation })) {
      attachVoxelEmissiveEnhancement(target, [
        { quadrantIndex: 0, emissiveColors: new Uint8Array(12).fill(127) },
      ]);
    }
  }

  assert.equal(targetGeometry.getAttribute("emissiveLight"), undefined);
  assert.equal(unrelatedGeometry.getAttribute("emissiveLight"), undefined);
});

test("normalized enhancement attributes attach in place only after full validation", () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(12), 3),
  );
  const mesh = new THREE.Mesh(geometry);
  const tile = {
    subMeshes: [{ quadrantIndex: 0, mesh }],
  } as never;
  const colors = new Uint8Array(12).fill(127);

  assert.equal(
    attachVoxelEmissiveEnhancement(tile, [
      { quadrantIndex: 0, emissiveColors: colors },
    ]),
    true,
  );
  const attribute = geometry.getAttribute("emissiveLight");
  assert.equal(attribute.normalized, true);
  assert.equal(attribute.array, colors);

  const before = attribute;
  assert.equal(
    attachVoxelEmissiveEnhancement(tile, [
      { quadrantIndex: 0, emissiveColors: new Uint8Array(3) },
    ]),
    false,
  );
  assert.equal(geometry.getAttribute("emissiveLight"), before);
});
