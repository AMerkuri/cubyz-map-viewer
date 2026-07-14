import assert from "node:assert/strict";
import test from "node:test";

import { runCancellableWorkerTask } from "../../../src/client/features/world-view/lib/voxel-worker-mechanics.js";

test("worker cancellation before allocation skips build and commitment", async () => {
  let built = false;
  let committed = false;

  const outcome = await runCancellableWorkerTask({
    budgetMs: 8,
    isCancelled: () => true,
    yieldControl: async () => {},
    build: async () => {
      built = true;
      return new Uint8Array(16);
    },
    commit: () => {
      committed = true;
    },
  });

  assert.deepEqual(outcome, { type: "cancelled" });
  assert.equal(built, false);
  assert.equal(committed, false);
});

test("worker yields and observes cancellation during a long optimized phase", async () => {
  let clock = 0;
  let cancelled = false;
  let yields = 0;
  let completedBatches = 0;

  const outcome = await runCancellableWorkerTask({
    budgetMs: 10,
    now: () => clock,
    isCancelled: () => cancelled,
    yieldControl: async () => {
      yields++;
      if (yields === 2) cancelled = true;
    },
    build: async (checkpoint) => {
      for (let batch = 0; batch < 10; batch++) {
        completedBatches++;
        clock += 6;
        await checkpoint("optimized-decode");
      }
      return new Uint8Array(1024);
    },
    commit: () => assert.fail("cancelled partial output must not be committed"),
  });

  assert.deepEqual(outcome, { type: "cancelled" });
  assert.equal(yields, 2);
  assert.ok(completedBatches < 10);
});

test("worker cancellation before transfer emits no committed result", async () => {
  let cancelled = false;
  let committed = false;

  const outcome = await runCancellableWorkerTask({
    budgetMs: 8,
    isCancelled: () => cancelled,
    yieldControl: async () => {},
    onCheckpoint: (phase) => {
      if (phase === "before-transfer") cancelled = true;
    },
    build: async (checkpoint) => {
      await checkpoint("quad-writing");
      await checkpoint("emissive-bake");
      return new Float32Array(64);
    },
    commit: () => {
      committed = true;
    },
  });

  assert.deepEqual(outcome, { type: "cancelled" });
  assert.equal(committed, false);
  assert.equal("value" in outcome, false);
});

test("cancellation after result commitment remains a committed race", async () => {
  let cancelled = false;
  const result = new Uint32Array([1, 2, 3]);

  const outcome = await runCancellableWorkerTask({
    budgetMs: 8,
    isCancelled: () => cancelled,
    yieldControl: async () => {},
    build: async () => result,
    commit: (value) => {
      assert.equal(value, result);
      cancelled = true;
    },
  });

  assert.deepEqual(outcome, { type: "committed", value: result });
  assert.equal(cancelled, true);
});
