import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compareVoxelWorkPriority,
  deriveVoxelWorkTiming,
  findMostUrgentVoxelWorkIndex,
  summarizeVoxelTimingSamples,
  type VoxelWorkPriority,
  VoxelWorkScheduler,
} from "../../../src/client/features/world-view/lib/voxel-work.js";

const basePriority: VoxelWorkPriority = {
  coverageClass: "detail",
  safetyClass: "optional",
  viewClass: "forward",
  phase: "base",
  projectedBenefit: 10,
  distance: 100,
  lod: 1,
  generation: 1,
  demandSince: 0,
  sequence: 1,
};

test("visible-hole safety and view class dominate optional refinement fields", () => {
  const coverage = {
    ...basePriority,
    coverageClass: "coverage" as const,
    safetyClass: "visible-hole" as const,
    viewClass: "peripheral" as const,
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

test("priority uses projected benefit, distance, lod, and stable sequence in order", () => {
  const sorted = [
    { ...basePriority, projectedBenefit: 9, sequence: 5 },
    { ...basePriority, distance: 110, sequence: 4 },
    { ...basePriority, lod: 2, sequence: 3 },
    { ...basePriority, sequence: 2 },
    basePriority,
  ].sort(compareVoxelWorkPriority);
  assert.equal(sorted[0]?.projectedBenefit, 10);
  assert.equal(sorted[0]?.distance, 100);
  assert.equal(sorted[0]?.lod, 1);
  assert.equal(sorted[0]?.sequence, 1);
});

test("continuous focus demand passes sustained non-visible coverage by its deadline", () => {
  const focus = {
    ...basePriority,
    viewClass: "focus" as const,
    demandSince: 0,
    sequence: 1,
  };
  const rearCoverage = {
    ...basePriority,
    coverageClass: "coverage" as const,
    safetyClass: "coverage" as const,
    viewClass: "rear" as const,
    demandSince: 1_900,
    sequence: 2,
  };
  assert.ok(compareVoxelWorkPriority(rearCoverage, focus, 1_999) < 0);
  assert.ok(compareVoxelWorkPriority(focus, rearCoverage, 2_000) < 0);

  const visibleHole = {
    ...rearCoverage,
    safetyClass: "visible-hole" as const,
    viewClass: "peripheral" as const,
    sequence: 3,
  };
  assert.ok(compareVoxelWorkPriority(visibleHole, focus, 10_000) < 0);
});

test("aging is capped and exact ties use stable sequence", () => {
  const older = { ...basePriority, demandSince: 0, sequence: 2 };
  const newer = { ...basePriority, demandSince: 5_000, sequence: 1 };
  const config = {
    focusDeadlineMs: 2_500,
    deadlinePromotionSlackMs: 500,
    maxAgingMs: 1_000,
  };
  assert.ok(compareVoxelWorkPriority(newer, older, 20_000, config) < 0);
  assert.equal(
    compareVoxelWorkPriority(newer, { ...newer }, 20_000, config),
    0,
  );
});

test("demand identity survives generations and resets after absence or refresh", () => {
  const scheduler = new VoxelWorkScheduler(
    { maxJobs: 1, maxBytes: 1 },
    { maxJobs: 1, maxBytes: 1 },
  );
  const first = {
    key: "tile",
    version: 1,
    priority: { ...basePriority, generation: 1 },
  };
  scheduler.reconcileDemand(new Map([[first.key, first]]), 100);
  const sequence = first.priority.sequence;
  const next = {
    key: "tile",
    version: 1,
    priority: { ...basePriority, generation: 2 },
  };
  scheduler.reconcileDemand(new Map([[next.key, next]]), 200);
  assert.equal(next.priority.demandSince, 100);
  assert.equal(next.priority.sequence, sequence);

  scheduler.reconcileDemand(new Map(), 250);
  scheduler.reconcileDemand(new Map([[next.key, next]]), 300);
  assert.equal(next.priority.demandSince, 300);
  assert.notEqual(next.priority.sequence, sequence);
  const refreshed = { ...next, version: 2, priority: { ...next.priority } };
  scheduler.reconcileDemand(new Map([[refreshed.key, refreshed]]), 400);
  assert.equal(refreshed.priority.demandSince, 400);
});

test("selected demand owns pre-fetch lifecycle timing and progress", () => {
  const scheduler = new VoxelWorkScheduler<ArrayBuffer, Uint8Array>(
    { maxJobs: 1, maxBytes: 10 },
    { maxJobs: 1, maxBytes: 10 },
  );
  const request = {
    key: "tile",
    version: 1,
    priority: { ...basePriority },
  };
  scheduler.reconcileDemand(new Map([[request.key, request]]), 10);
  const selected = scheduler.getByKey("tile")[0];
  assert.equal(selected?.stage, "selected");
  assert.equal(scheduler.hasExecutableBaseWork(), true);
  assert.deepEqual(scheduler.assertProgressInvariant(), []);
  assert.equal(scheduler.markFetchQueued("tile", 1), true);
  const fetching = scheduler.createFetching({
    ...request,
    selectedAt: 999,
    fetchStartedAt: 18,
  });
  assert.equal(fetching.jobId, selected?.jobId);
  assert.equal(fetching.timestamps.selectedAt, 10);
  assert.equal(
    deriveVoxelWorkTiming(fetching.timestamps).selectionToFetchStartMs,
    8,
  );
});

test("non-executable demand remains observable without blocking base isolation", () => {
  const scheduler = new VoxelWorkScheduler<ArrayBuffer, Uint8Array>(
    { maxJobs: 1, maxBytes: 10 },
    { maxJobs: 1, maxBytes: 10 },
  );
  const request = {
    key: "missing",
    version: 1,
    priority: { ...basePriority },
    demandState: "known-missing" as const,
  };
  scheduler.reconcileDemand(new Map([[request.key, request]]), 10);
  assert.equal(scheduler.hasExecutableBaseWork(), false);
  assert.equal(scheduler.getDiagnostics(20).currentQueue.jobs, 0);
  assert.equal(
    scheduler.getDiagnostics(20).currentQueue.nonExecutableDemand[
      "known-missing"
    ],
    1,
  );
  assert.deepEqual(scheduler.assertProgressInvariant(), []);
});

test("executable base pressure spans lifecycle stages without priority filtering", () => {
  const scheduler = new VoxelWorkScheduler<ArrayBuffer, Uint8Array>(
    { maxJobs: 16, maxBytes: 1_000 },
    { maxJobs: 16, maxBytes: 1_000 },
  );
  const priorities = [
    { safetyClass: "visible-hole" as const, viewClass: "focus" as const },
    { safetyClass: "coverage" as const, viewClass: "rear" as const },
    { safetyClass: "optional" as const, viewClass: "forward" as const },
    { safetyClass: "optional" as const, viewClass: "peripheral" as const },
    { safetyClass: "optional" as const, viewClass: "rear" as const },
    { safetyClass: "visible-hole" as const, viewClass: "focus" as const },
    { safetyClass: "optional" as const, viewClass: "forward" as const },
  ];
  const requests = priorities.map((priority, index) => ({
    key: `pressure-${index}`,
    version: 1,
    priority: {
      ...basePriority,
      ...priority,
      demandSince: 0,
      sequence: index + 1,
    },
  }));
  scheduler.reconcileDemand(
    new Map(requests.map((request) => [request.key, request])),
    0,
  );
  scheduler.markFetchQueued("pressure-1", 1);
  const fetching = scheduler.createFetching({
    ...requests[2],
    selectedAt: 0,
    fetchStartedAt: 1,
  });
  const compact = scheduler.createFetching({
    ...requests[3],
    selectedAt: 0,
    fetchStartedAt: 1,
  });
  scheduler.acceptCompact(compact.jobId, new ArrayBuffer(1), 1, 2);
  const meshingInput = scheduler.createFetching({
    ...requests[4],
    selectedAt: 0,
    fetchStartedAt: 1,
  });
  scheduler.acceptCompact(meshingInput.jobId, new ArrayBuffer(1), 1, 2);
  const meshing = scheduler.dispatchNext(3, 1);
  assert.ok(meshing);
  const expandedInput = scheduler.createFetching({
    ...requests[5],
    selectedAt: 0,
    fetchStartedAt: 1,
  });
  scheduler.acceptCompact(expandedInput.jobId, new ArrayBuffer(1), 1, 2);
  const expanded = scheduler.dispatchNext(3, 2);
  assert.ok(expanded);
  scheduler.completeWorker(expanded.jobId, new Uint8Array(1), 1, {
    workerStartedAt: 3,
    workerCompletedAt: 4,
    resultReceivedAt: 5,
  });
  const insertedInput = scheduler.createFetching({
    ...requests[6],
    selectedAt: 0,
    fetchStartedAt: 1,
  });
  scheduler.acceptCompact(insertedInput.jobId, new ArrayBuffer(1), 1, 2);
  const inserted = scheduler.dispatchNext(3, 3);
  assert.ok(inserted);
  scheduler.completeWorker(inserted.jobId, new Uint8Array(1), 1, {
    workerStartedAt: 3,
    workerCompletedAt: 4,
    resultReceivedAt: 5,
  });
  scheduler.markSceneInserted(inserted.jobId, 6);

  assert.deepEqual(scheduler.getExecutableBasePressure(1_000), {
    jobs: 7,
    oldestAgeMs: 1_000,
  });
  scheduler.cancel(meshing.jobId, "demand-removed");
  assert.equal(scheduler.getExecutableBasePressure(1_000).jobs, 6);
  scheduler.reprioritize(fetching.jobId, {
    ...basePriority,
    safetyClass: "optional",
    viewClass: "rear",
    demandSince: 0,
    sequence: 99,
  });
  assert.equal(scheduler.getExecutableBasePressure(1_000).oldestAgeMs, 1_000);
});

test("base pressure excludes non-executable demand, enhancement, and a cancelled tail", () => {
  const scheduler = new VoxelWorkScheduler<ArrayBuffer, Uint8Array>(
    { maxJobs: 4, maxBytes: 100 },
    { maxJobs: 4, maxBytes: 100 },
  );
  const executable = {
    key: "executable",
    version: 1,
    priority: { ...basePriority },
  };
  const missing = {
    key: "missing",
    version: 1,
    priority: { ...basePriority },
    demandState: "known-missing" as const,
  };
  const delayed = {
    key: "delayed",
    version: 1,
    priority: { ...basePriority },
    demandState: "retry-delayed" as const,
  };
  scheduler.reconcileDemand(
    new Map([
      [executable.key, executable],
      [missing.key, missing],
      [delayed.key, delayed],
    ]),
    10,
  );
  scheduler.createRetainedEnhancement({
    key: "enhancement",
    version: 1,
    priority: { ...basePriority },
    selectedAt: 10,
    retainedAt: 10,
    compact: new ArrayBuffer(1),
    compactBytes: 1,
    baseMeshId: 1,
  });
  assert.deepEqual(scheduler.getExecutableBasePressure(20), {
    jobs: 1,
    oldestAgeMs: 10,
  });
  const record = scheduler.getByKey(executable.key)[0];
  assert.ok(record);
  scheduler.cancel(record.jobId, "demand-removed");
  assert.deepEqual(scheduler.getExecutableBasePressure(20), {
    jobs: 0,
    oldestAgeMs: 0,
  });
});

test("retained enhancement capacity cannot close base fetch admission", () => {
  const scheduler = new VoxelWorkScheduler<ArrayBuffer, Uint8Array>(
    { maxJobs: 1, maxBytes: 1 },
    { maxJobs: 2, maxBytes: 10 },
    256,
    {
      maxJobs: 1,
      maxBytes: 1,
      highWaterJobs: 1,
      highWaterBytes: 1,
      lowWaterJobs: 0,
      lowWaterBytes: 0,
    },
  );
  scheduler.createRetainedEnhancement({
    key: "enhancement",
    version: 1,
    priority: { ...basePriority },
    selectedAt: 0,
    retainedAt: 1,
    compact: new ArrayBuffer(1),
    compactBytes: 1,
    baseMeshId: 1,
  });
  assert.equal(scheduler.canStartFetch(), true);
  const base = scheduler.createFetching({
    key: "base",
    version: 1,
    priority: { ...basePriority },
    selectedAt: 0,
    fetchStartedAt: 1,
  });
  scheduler.acceptCompact(base.jobId, new ArrayBuffer(1), 1, 2);
  assert.deepEqual(scheduler.snapshot().compactInput, { jobs: 1, bytes: 1 });
  assert.deepEqual(scheduler.snapshot().retainedEnhancementInput, {
    jobs: 1,
    bytes: 1,
  });
  assert.deepEqual(scheduler.snapshot().totalCompactInput, {
    jobs: 2,
    bytes: 2,
  });
  assert.equal(scheduler.canStartFetch(), false);
});

test("retained enhancement overflow preserves every completed base buffer", () => {
  const scheduler = new VoxelWorkScheduler<ArrayBuffer, Uint8Array>(
    { maxJobs: 2, maxBytes: 10 },
    { maxJobs: 2, maxBytes: 10 },
    256,
    {
      maxJobs: 1,
      maxBytes: 1,
      highWaterJobs: 1,
      highWaterBytes: 1,
      lowWaterJobs: 0,
      lowWaterBytes: 0,
    },
  );
  for (const key of ["first", "second"]) {
    scheduler.createRetainedEnhancement({
      key,
      version: 1,
      priority: { ...basePriority },
      selectedAt: 0,
      retainedAt: 1,
      compact: new ArrayBuffer(1),
      compactBytes: 1,
      baseMeshId: 1,
    });
  }
  assert.deepEqual(scheduler.snapshot().retainedEnhancementInput, {
    jobs: 2,
    bytes: 2,
  });
  assert.equal(scheduler.dispatchNext(2)?.phase, "enhancement");
});

test("enhancement waits for selected base work outside the compact queue", () => {
  const scheduler = new VoxelWorkScheduler<ArrayBuffer, Uint8Array>(
    { maxJobs: 2, maxBytes: 10 },
    { maxJobs: 2, maxBytes: 10 },
  );
  scheduler.createRetainedEnhancement({
    key: "enhancement",
    version: 1,
    priority: { ...basePriority },
    selectedAt: 0,
    retainedAt: 1,
    compact: new ArrayBuffer(1),
    compactBytes: 1,
    baseMeshId: 1,
  });
  const base = {
    key: "base",
    version: 1,
    priority: { ...basePriority },
  };
  scheduler.reconcileDemand(new Map([[base.key, base]]), 2);
  assert.equal(scheduler.dispatchNext(3), null);
  scheduler.reconcileDemand(
    new Map([[base.key, { ...base, demandState: "fresh" as const }]]),
    4,
  );
  assert.equal(scheduler.dispatchNext(5)?.phase, "enhancement");
});

test("base waves cover fetch gaps and drain retained enhancement after settlement", () => {
  const scheduler = new VoxelWorkScheduler<ArrayBuffer, Uint8Array>(
    { maxJobs: 4, maxBytes: 10 },
    { maxJobs: 4, maxBytes: 10 },
    256,
    {
      maxJobs: 2,
      maxBytes: 10,
      highWaterJobs: 2,
      highWaterBytes: 10,
      lowWaterJobs: 1,
      lowWaterBytes: 5,
    },
  );
  scheduler.createRetainedEnhancement({
    key: "enhancement",
    version: 1,
    priority: { ...basePriority },
    selectedAt: 0,
    retainedAt: 1,
    compact: new ArrayBuffer(1),
    compactBytes: 1,
    baseMeshId: 1,
  });
  const requests = ["first", "second"].map((key, sequence) => ({
    key,
    version: 1,
    priority: { ...basePriority, sequence: sequence + 1 },
  }));
  scheduler.reconcileDemand(
    new Map(requests.map((request) => [request.key, request])),
    2,
  );
  for (const request of requests) {
    scheduler.markFetchQueued(request.key, request.version);
    scheduler.createFetching({
      ...request,
      selectedAt: 2,
      fetchStartedAt: 3,
    });
  }

  // An active base fetch keeps normal enhancement work from filling idle lanes.
  assert.equal(scheduler.dispatchNext(4, 1, 1, { activeWorkerCount: 2 }), null);

  for (const request of requests) {
    const record = scheduler.getByKey(request.key)[0];
    assert.ok(record);
    scheduler.acceptCompact(record.jobId, new ArrayBuffer(1), 1, 5);
  }
  const first = scheduler.dispatchNext(6, 1, 1, { activeWorkerCount: 2 });
  const second = scheduler.dispatchNext(6, 2, 1, { activeWorkerCount: 2 });
  assert.equal(first?.phase, "base");
  assert.equal(second?.phase, "base");

  for (const [index, record] of [first, second].entries()) {
    assert.ok(record);
    scheduler.completeWorker(record.jobId, new Uint8Array(1), 1, {
      workerStartedAt: 6,
      workerCompletedAt: 7,
      resultReceivedAt: 8,
    });
    scheduler.markSceneInserted(record.jobId, 9);
    scheduler.markFirstVisible(record.jobId, 10 + index);
  }
  assert.equal(scheduler.hasExecutableBaseWork(), false);
  assert.equal(
    scheduler.dispatchNext(12, 1, 1, { activeWorkerCount: 2 })?.phase,
    "enhancement",
  );
});

test("one worker uses bounded enhancement pressure relief without closing base fetch admission", () => {
  const scheduler = new VoxelWorkScheduler<ArrayBuffer, Uint8Array>(
    { maxJobs: 1, maxBytes: 1 },
    { maxJobs: 2, maxBytes: 10 },
    256,
    {
      maxJobs: 1,
      maxBytes: 1,
      highWaterJobs: 1,
      highWaterBytes: 1,
      lowWaterJobs: 0,
      lowWaterBytes: 0,
    },
  );
  scheduler.createRetainedEnhancement({
    key: "enhancement",
    version: 1,
    priority: { ...basePriority },
    selectedAt: 0,
    retainedAt: 1,
    compact: new ArrayBuffer(1),
    compactBytes: 1,
    baseMeshId: 1,
  });
  const base = { key: "base", version: 1, priority: { ...basePriority } };
  scheduler.reconcileDemand(new Map([[base.key, base]]), 2);
  assert.equal(scheduler.canStartFetch(), true);
  assert.equal(
    scheduler.dispatchNext(3, 1, 1, { activeWorkerCount: 1 })?.phase,
    "enhancement",
  );
});

test("queued scene selection uses latest urgency rather than insertion order", () => {
  const items = [
    { jobId: 1, priority: { ...basePriority, sequence: 1 } },
    { jobId: 2, priority: { ...basePriority, sequence: 2 } },
  ];
  const latest = new Map([
    [1, items[0]?.priority as VoxelWorkPriority],
    [
      2,
      {
        ...items[1]?.priority,
        viewClass: "focus" as const,
        demandSince: 0,
      } as VoxelWorkPriority,
    ],
  ]);
  assert.equal(
    findMostUrgentVoxelWorkIndex(
      items,
      (item) => latest.get(item.jobId) ?? item.priority,
      2_000,
    ),
    1,
  );
});

test("queued compact work reprioritizes without preempting active work", () => {
  const scheduler = new VoxelWorkScheduler<ArrayBuffer, Uint8Array>(
    { maxJobs: 3, maxBytes: 10 },
    { maxJobs: 3, maxBytes: 10 },
  );
  const first = scheduler.createFetching({
    key: "first",
    version: 0,
    priority: { ...basePriority, sequence: 1 },
    selectedAt: 0,
    fetchStartedAt: 0,
  });
  const second = scheduler.createFetching({
    key: "second",
    version: 0,
    priority: { ...basePriority, sequence: 2 },
    selectedAt: 0,
    fetchStartedAt: 0,
  });
  scheduler.acceptCompact(first.jobId, new ArrayBuffer(1), 1, 1);
  scheduler.acceptCompact(second.jobId, new ArrayBuffer(1), 1, 1);
  scheduler.reprioritize(second.jobId, {
    ...basePriority,
    viewClass: "focus",
    demandSince: 0,
    sequence: 2,
  });
  assert.equal(scheduler.dispatchNext(2)?.jobId, second.jobId);
  assert.equal(
    scheduler.reprioritize(second.jobId, {
      ...basePriority,
      viewClass: "rear",
      sequence: 2,
    }),
    true,
  );
  assert.equal(scheduler.dispatchNext(3), null);
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
  const dispatched = scheduler.dispatchNext(3, 7, 9);
  assert.equal(dispatched?.jobId, record.jobId);
  assert.equal(dispatched?.workerId, 7);
  assert.deepEqual(scheduler.snapshot().reservedExpandedOutput, {
    jobs: 1,
    bytes: 9,
  });
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
  assert.deepEqual(scheduler.snapshot().reservedExpandedOutput, {
    jobs: 0,
    bytes: 0,
  });
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
      selectionToFetchStartMs: 2,
      fetchMs: 8,
      compactQueueWaitMs: 5,
      baseWorkerExecutionMs: 13,
      resultTransferWaitMs: 3,
      sceneQueueWaitMs: 7,
      selectionToBaseVisibleMs: 48,
      enhancementQueueWaitMs: 5,
      enhancementWorkerExecutionMs: 13,
      enhancementResultTransferWaitMs: 3,
      enhancementAttachWaitMs: null,
      selectionToEnhancedMs: null,
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

test("bounded timing percentiles use independent optional populations", () => {
  assert.deepEqual(
    summarizeVoxelTimingSamples([null, 1, 2, null, 3, 4, 100], 5),
    {
      count: 5,
      p50Ms: 3,
      p95Ms: 100,
      maxMs: 100,
    },
  );
  assert.deepEqual(summarizeVoxelTimingSamples([null, null]), {
    count: 0,
    p50Ms: null,
    p95Ms: null,
    maxMs: null,
  });
});

test("load generation reset clears bounded populations but retains outcomes", () => {
  const scheduler = new VoxelWorkScheduler<ArrayBuffer, Uint8Array>(
    { maxJobs: 2, maxBytes: 10 },
    { maxJobs: 2, maxBytes: 10 },
  );
  const cancelled = scheduler.createFetching({
    key: "cancelled",
    version: 1,
    priority: basePriority,
    selectedAt: 0,
    fetchStartedAt: 1,
  });
  scheduler.cancelKey(cancelled.key, "demand-removed");

  const loaded = scheduler.createFetching({
    key: "loaded",
    version: 1,
    priority: basePriority,
    selectedAt: 0,
    fetchStartedAt: 1,
  });
  scheduler.acceptCompact(loaded.jobId, new ArrayBuffer(1), 1, 2);
  scheduler.dispatchNext(3);
  scheduler.completeWorker(loaded.jobId, new Uint8Array(1), 1, {
    workerStartedAt: 4,
    workerCompletedAt: 5,
    resultReceivedAt: 6,
  });
  scheduler.markSceneInserted(loaded.jobId, 7);
  scheduler.markFirstVisible(loaded.jobId, 8);
  assert.equal(scheduler.diagnostics.timings.fetchMs.count, 1);

  assert.equal(scheduler.resetLoadGeneration(), 2);
  assert.equal(scheduler.diagnostics.timings.fetchMs.count, 0);
  assert.deepEqual(scheduler.diagnostics.cancellations, {
    "fetching:demand-removed": 1,
  });
});

test("diagnostics report deadline misses and current oldest queue groups", () => {
  const scheduler = new VoxelWorkScheduler<ArrayBuffer, Uint8Array>(
    { maxJobs: 4, maxBytes: 10 },
    { maxJobs: 4, maxBytes: 10 },
  );
  const focus = scheduler.createFetching({
    key: "focus",
    version: 1,
    priority: {
      ...basePriority,
      viewClass: "focus",
      demandSince: 0,
    },
    selectedAt: 0,
    fetchStartedAt: 1,
  });
  scheduler.acceptCompact(focus.jobId, new ArrayBuffer(1), 1, 2);
  scheduler.dispatchNext(3);
  scheduler.completeWorker(focus.jobId, new Uint8Array(1), 1, {
    workerStartedAt: 4,
    workerCompletedAt: 5,
    resultReceivedAt: 6,
  });
  scheduler.markSceneInserted(focus.jobId, 7);
  scheduler.markFirstVisible(focus.jobId, 3_000);

  scheduler.createFetching({
    key: "coverage",
    version: 1,
    priority: {
      ...basePriority,
      coverageClass: "coverage",
      safetyClass: "coverage",
      viewClass: "rear",
      lod: 4,
      demandSince: 100,
    },
    selectedAt: 100,
    fetchStartedAt: 101,
  });
  scheduler.createFetching({
    key: "enhancement",
    version: 1,
    priority: {
      ...basePriority,
      phase: "enhancement",
      viewClass: "peripheral",
      lod: 2,
      demandSince: 400,
    },
    selectedAt: 400,
    fetchStartedAt: 401,
  });

  const diagnostics = scheduler.getDiagnostics(1_000);
  assert.equal(diagnostics.focusDeadlineMisses, 1);
  assert.equal(diagnostics.currentQueue.jobs, 2);
  assert.equal(diagnostics.currentQueue.oldestDemandAgeMs.overall, 900);
  assert.deepEqual(diagnostics.currentQueue.oldestDemandAgeMs.byLod, {
    "2": 600,
    "4": 900,
  });
  assert.deepEqual(diagnostics.currentQueue.oldestDemandAgeMs.byPhase, {
    base: 900,
    enhancement: 600,
  });
  assert.deepEqual(diagnostics.currentQueue.oldestDemandAgeMs.byViewClass, {
    peripheral: 600,
    rear: 900,
  });
});

test("current queue diagnostics include demand waiting for fetch admission", () => {
  const scheduler = new VoxelWorkScheduler(
    { maxJobs: 1, maxBytes: 1 },
    { maxJobs: 1, maxBytes: 1 },
  );
  const pending = {
    key: "pending",
    version: 1,
    priority: { ...basePriority, lod: 8, viewClass: "rear" as const },
  };
  scheduler.reconcileDemand(new Map([[pending.key, pending]]), 100);

  const currentQueue = scheduler.getDiagnostics(600).currentQueue;
  assert.equal(currentQueue.jobs, 1);
  assert.equal(currentQueue.oldestDemandAgeMs.overall, 500);
  assert.deepEqual(currentQueue.oldestDemandAgeMs.byLod, { "8": 500 });
});

test("runtime controller observations are bounded and generation scoped", () => {
  const scheduler = new VoxelWorkScheduler(
    { maxJobs: 1, maxBytes: 1 },
    { maxJobs: 1, maxBytes: 1 },
    2,
  );
  scheduler.observeRuntime({
    frameTimeMs: 5,
    workerBusy: false,
    reservedExpandedBytes: 0,
    activeWorkers: 1,
    targetWorkers: 1,
  });
  scheduler.observeRuntime({
    frameTimeMs: 10,
    workerBusy: true,
    reservedExpandedBytes: 20,
    activeWorkers: 1,
    targetWorkers: 1,
  });
  scheduler.observeRuntime({
    frameTimeMs: 20,
    workerBusy: true,
    reservedExpandedBytes: 40,
    activeWorkers: 1,
    targetWorkers: 1,
  });
  assert.deepEqual(scheduler.diagnostics.observations.frameTimeMs, {
    count: 2,
    p50: 10,
    p95: 20,
    max: 20,
  });
  assert.equal(scheduler.diagnostics.observations.workerBusyRatio.p50, 1);
  scheduler.resetLoadGeneration();
  assert.equal(scheduler.diagnostics.observations.frameTimeMs.count, 0);
});
