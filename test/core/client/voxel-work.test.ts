import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compareVoxelWorkPriority,
  deriveVoxelWorkTiming,
  type VoxelWorkPriority,
  VoxelWorkScheduler,
} from "../../../src/client/features/world-view/lib/voxel-work.js";

const basePriority: VoxelWorkPriority = {
  coverageClass: "detail",
  viewClass: "forward",
  projectedBenefit: 10,
  distance: 100,
  lod: 1,
  generation: 1,
};

test("coverage and view class dominate optional refinement fields", () => {
  const coverage = {
    ...basePriority,
    coverageClass: "coverage" as const,
    viewClass: "rear" as const,
    projectedBenefit: 0,
    distance: 10_000,
    lod: 32,
  };
  assert.ok(compareVoxelWorkPriority(coverage, basePriority) < 0);
  assert.ok(
    compareVoxelWorkPriority(
      { ...basePriority, viewClass: "forward" },
      { ...basePriority, viewClass: "peripheral", projectedBenefit: 1_000 },
    ) < 0,
  );
});

test("priority uses projected benefit, distance, lod, and newest generation in order", () => {
  const sorted = [
    { ...basePriority, projectedBenefit: 9 },
    { ...basePriority, distance: 110 },
    { ...basePriority, lod: 2 },
    { ...basePriority, generation: 2 },
    basePriority,
  ].sort(compareVoxelWorkPriority);
  assert.equal(sorted[0]?.projectedBenefit, 10);
  assert.equal(sorted[0]?.distance, 100);
  assert.equal(sorted[0]?.lod, 1);
  assert.equal(sorted[0]?.generation, 2);
});

test("compact input accounting admits completed fetches then blocks upstream", () => {
  const scheduler = new VoxelWorkScheduler<ArrayBuffer, Uint8Array>(
    { maxJobs: 2, maxBytes: 10 },
    { maxJobs: 2, maxBytes: 10 },
  );
  const first = scheduler.createFetching({
    key: "first",
    version: 0,
    priority: basePriority,
    selectedAt: 0,
    fetchStartedAt: 1,
  });
  const second = scheduler.createFetching({
    key: "second",
    version: 0,
    priority: basePriority,
    selectedAt: 0,
    fetchStartedAt: 1,
  });
  assert.equal(scheduler.canStartFetch(), true);
  assert.equal(
    scheduler.acceptCompact(first.jobId, new ArrayBuffer(11), 11, 2),
    true,
  );
  assert.equal(scheduler.canStartFetch(), false);
  assert.equal(
    scheduler.acceptCompact(second.jobId, new ArrayBuffer(1), 1, 2),
    true,
  );
  assert.deepEqual(scheduler.snapshot().compactInput, { jobs: 2, bytes: 12 });
});

test("worker and expanded output capacity release exactly once", () => {
  const scheduler = new VoxelWorkScheduler<ArrayBuffer, Uint8Array>(
    { maxJobs: 2, maxBytes: 10 },
    { maxJobs: 1, maxBytes: 10 },
  );
  const record = scheduler.createFetching({
    key: "tile",
    version: 1,
    priority: basePriority,
    selectedAt: 0,
    fetchStartedAt: 1,
  });
  assert.equal(
    scheduler.acceptCompact(record.jobId, new ArrayBuffer(2), 2, 2),
    true,
  );
  assert.equal(scheduler.dispatchNext(3)?.jobId, record.jobId);
  assert.equal(scheduler.dispatchNext(3), null);
  assert.equal(
    scheduler.completeWorker(record.jobId, new Uint8Array(12), 12, {
      workerStartedAt: 3,
      workerCompletedAt: 4,
      resultReceivedAt: 5,
    }),
    true,
  );
  assert.deepEqual(scheduler.snapshot().expandedOutput, { jobs: 1, bytes: 12 });
  assert.equal(scheduler.finish(record.jobId, "loaded"), true);
  assert.equal(scheduler.finish(record.jobId, "error"), false);
  assert.deepEqual(scheduler.snapshot().expandedOutput, { jobs: 0, bytes: 0 });
});

test("errors, cancellation, and duplicate terminal events keep accounting stable", () => {
  const scheduler = new VoxelWorkScheduler<ArrayBuffer, Uint8Array>(
    { maxJobs: 2, maxBytes: 10 },
    { maxJobs: 2, maxBytes: 10 },
  );
  const queued = scheduler.createFetching({
    key: "tile",
    version: 1,
    priority: basePriority,
    selectedAt: 0,
    fetchStartedAt: 1,
  });
  scheduler.acceptCompact(queued.jobId, new ArrayBuffer(2), 2, 2);
  const cancelled = scheduler.cancelKey("tile", "refresh-superseded", 2);
  assert.equal(cancelled.length, 1);
  assert.equal(scheduler.finish(queued.jobId, "error"), false);
  assert.deepEqual(scheduler.snapshot().compactInput, { jobs: 0, bytes: 0 });
});

test("stage timing derivation keeps independently measurable waits", () => {
  assert.deepEqual(
    deriveVoxelWorkTiming({
      selectedAt: 10,
      fetchStartedAt: 12,
      fetchCompletedAt: 20,
      workerDispatchedAt: 25,
      workerStartedAt: 27,
      workerCompletedAt: 40,
      resultReceivedAt: 43,
      sceneInsertedAt: 50,
      firstVisibleAt: 58,
    }),
    {
      fetchMs: 8,
      compactQueueWaitMs: 5,
      workerExecutionMs: 13,
      resultTransferWaitMs: 3,
      sceneQueueWaitMs: 7,
      requestToVisibleMs: 48,
    },
  );
});

test("terminal accounting separates cancellation and discard stage reasons", () => {
  const scheduler = new VoxelWorkScheduler<ArrayBuffer, Uint8Array>(
    { maxJobs: 2, maxBytes: 10 },
    { maxJobs: 2, maxBytes: 10 },
  );
  const cancelled = scheduler.createFetching({
    key: "cancelled",
    version: 0,
    priority: basePriority,
    selectedAt: 0,
    fetchStartedAt: 1,
  });
  scheduler.cancelKey("cancelled", "demand-removed");
  const discarded = scheduler.createFetching({
    key: "discarded",
    version: 0,
    priority: basePriority,
    selectedAt: 0,
    fetchStartedAt: 1,
  });
  scheduler.acceptCompact(discarded.jobId, new ArrayBuffer(1), 1, 2);
  scheduler.finish(discarded.jobId, "discarded", "result-validation");
  const raced = scheduler.createFetching({
    key: "raced",
    version: 0,
    priority: basePriority,
    selectedAt: 0,
    fetchStartedAt: 1,
  });
  scheduler.acceptCompact(raced.jobId, new ArrayBuffer(1), 1, 2);
  scheduler.dispatchNext(3);
  scheduler.cancelKey("raced", "demand-removed");
  scheduler.finish(raced.jobId, "discarded", "cancel-race");

  assert.equal(cancelled.terminalOutcome, "cancelled");
  assert.deepEqual(scheduler.diagnostics.cancellations, {
    "fetching:demand-removed": 1,
  });
  assert.deepEqual(scheduler.diagnostics.discards, {
    "compact-input:result-validation": 1,
    "meshing:cancel-race": 1,
  });
});
