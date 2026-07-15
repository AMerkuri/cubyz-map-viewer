import assert from "node:assert/strict";
import { test } from "node:test";

import type { BlockColorTable } from "../../../src/server/services/block-color-table.js";
import type { BlockShapeTable } from "../../../src/server/services/block-shape-table.js";
import {
  type VoxelWorkerLike,
  VoxelWorkerPool,
} from "../../../src/server/services/voxel-worker-pool.js";
import type {
  VoxelJob,
  VoxelJobResult,
  VoxelWorkerDiagnostics,
  VoxelWorkerMessage,
  VoxelWorkerResponseMessage,
} from "../../../src/server/workers/voxel-worker-protocol.js";

const blockColors = { signature: "colors" } as BlockColorTable;
const blockShapes = { signature: "shapes" } as BlockShapeTable;

function job(id: number): VoxelJob {
  return {
    id,
    key: `1/${id}/0`,
    lod: 1,
    regionX: id,
    regionY: 0,
    globalEpoch: 0,
    keyEpoch: 0,
  };
}

function diagnostics(
  overrides: Partial<VoxelWorkerDiagnostics> = {},
): VoxelWorkerDiagnostics {
  return {
    heapUsed: 10,
    heapTotal: 20,
    external: 30,
    arrayBuffers: 40,
    completedJobs: 1,
    representedEmitterCacheEntries: 2,
    representedEmitterCacheSources: 3,
    representedEmitterInFlight: 0,
    ...overrides,
    phase: overrides.phase ?? "idle",
  };
}

class FakeWorker implements VoxelWorkerLike {
  readonly messages: VoxelWorkerMessage[] = [];
  terminateCalls = 0;
  private readonly listeners = {
    message: [] as Array<(result: VoxelWorkerResponseMessage) => void>,
    error: [] as Array<(error: Error) => void>,
    exit: [] as Array<(code: number) => void>,
  };
  private terminateResolve?: (code: number) => void;

  constructor(private readonly controlledTermination = false) {}

  postMessage(message: VoxelWorkerMessage): void {
    this.messages.push(message);
  }

  terminate(): Promise<number> {
    this.terminateCalls++;
    if (!this.controlledTermination) return Promise.resolve(0);
    return new Promise((resolve) => {
      this.terminateResolve = resolve;
    });
  }

  finishTermination(): void {
    this.terminateResolve?.(0);
  }

  on(
    event: "message",
    listener: (result: VoxelWorkerResponseMessage) => void,
  ): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "exit", listener: (code: number) => void): this;
  on(
    event: "message" | "error" | "exit",
    listener:
      | ((result: VoxelWorkerResponseMessage) => void)
      | ((error: Error) => void)
      | ((code: number) => void),
  ): this {
    (this.listeners[event] as Array<typeof listener>).push(listener);
    return this;
  }

  completeResult(id: number, memory = diagnostics()): void {
    const request = this.messages.find(
      (message) => message.type === "job" && message.job.id === id,
    );
    assert.ok(request?.type === "job");
    const result: VoxelJobResult = {
      id,
      key: request.job.key,
      globalEpoch: 0,
      keyEpoch: 0,
      status: "empty",
      runMs: 1,
      preTransferDiagnostics: { ...memory, phase: "pre-transfer" },
    };
    for (const listener of this.listeners.message) listener(result);
  }

  becomeIdle(id: number, memory = diagnostics()): void {
    for (const listener of this.listeners.message) {
      listener({
        type: "idle",
        id,
        diagnostics: { ...memory, phase: "idle" },
      });
    }
  }

  complete(id: number, memory = diagnostics()): void {
    this.completeResult(id, memory);
    this.becomeIdle(id, memory);
  }

  fail(error = new Error("worker failed")): void {
    for (const listener of this.listeners.error) listener(error);
  }
}

function createPool(
  size: number,
  options: ConstructorParameters<typeof VoxelWorkerPool>[4] = {},
  controlledTermination = false,
): { pool: VoxelWorkerPool; workers: FakeWorker[] } {
  const workers: FakeWorker[] = [];
  const pool = new VoxelWorkerPool("/save", blockColors, blockShapes, size, {
    ...options,
    workerFactory: () => {
      const worker = new FakeWorker(
        controlledTermination && workers.length < size,
      );
      workers.push(worker);
      return worker;
    },
  });
  return { pool, workers };
}

async function turn(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test("retires an idle worker after it crosses a configured threshold", async () => {
  const { pool, workers } = createPool(1, { recycleHeapBytes: 100 });
  await pool.start();
  const result = pool.run(job(1));
  workers[0].complete(1, diagnostics({ heapUsed: 100 }));
  await result;
  await turn();
  assert.equal(workers.length, 2);
  assert.equal(pool.getDiagnosticsSnapshot().retirementReasons.heap, 1);
  await pool.destroy();
});

test("waits for the post-transfer idle boundary before settlement and reuse", async () => {
  const { pool, workers } = createPool(1, {
    recycleArrayBufferBytes: 500,
  });
  await pool.start();
  const first = pool.run(job(1));
  const second = pool.run(job(2));
  let settled = false;
  void first.then(() => {
    settled = true;
  });

  workers[0].completeResult(1, diagnostics({ arrayBuffers: 900 }));
  await turn();
  assert.equal(settled, false);
  assert.equal(workers[0].messages.length, 1);

  workers[0].becomeIdle(1, diagnostics({ arrayBuffers: 40 }));
  await first;
  assert.equal(workers[0].messages.length, 2);
  const snapshot = pool.getDiagnosticsSnapshot();
  assert.equal(snapshot.preTransferArrayBuffers, 900);
  assert.equal(snapshot.arrayBuffers, 40);
  assert.equal(snapshot.preTransferSlots[0]?.phase, "pre-transfer");
  assert.equal(snapshot.slots[0]?.phase, "idle");
  assert.equal(snapshot.retirements, 0);

  workers[0].complete(2);
  await second;
  await pool.destroy();
});

test("keeps workers reusable when recycling thresholds are disabled", async () => {
  const { pool, workers } = createPool(1, {
    recycleHeapBytes: 0,
    recycleExternalBytes: 0,
    recycleArrayBufferBytes: 0,
    recycleCompletedJobs: 0,
  });
  await pool.start();
  const first = pool.run(job(1));
  workers[0].complete(1);
  await first;
  const second = pool.run(job(2));
  workers[0].complete(2);
  await second;
  assert.equal(workers.length, 1);
  assert.equal(pool.getDiagnosticsSnapshot().retirements, 0);
  await pool.destroy();
});

test("uses deterministic retirement threshold precedence", async () => {
  const { pool, workers } = createPool(1, {
    recycleHeapBytes: 100,
    recycleExternalBytes: 100,
    recycleArrayBufferBytes: 100,
    recycleCompletedJobs: 1,
  });
  await pool.start();
  const result = pool.run(job(1));
  workers[0].complete(
    1,
    diagnostics({
      heapUsed: 100,
      external: 100,
      arrayBuffers: 100,
      completedJobs: 1,
    }),
  );
  await result;
  await turn();
  assert.deepEqual(pool.getDiagnosticsSnapshot().retirementReasons, {
    heap: 1,
  });
  await pool.destroy();
});

test("serializes simultaneous routine retirements", async () => {
  const { pool, workers } = createPool(2, { recycleCompletedJobs: 1 }, true);
  await pool.start();
  const first = pool.run(job(1));
  const second = pool.run(job(2));
  workers[0].complete(1);
  workers[1].complete(2);
  await Promise.all([first, second]);
  assert.equal(workers[0].terminateCalls + workers[1].terminateCalls, 1);
  workers[0].finishTermination();
  await turn();
  assert.equal(workers[1].terminateCalls, 1);
  workers[1].finishTermination();
  await turn();
  await pool.destroy();
});

test("preserves queued work across threshold replacement", async () => {
  const { pool, workers } = createPool(1, { recycleCompletedJobs: 1 });
  await pool.start();
  const first = pool.run(job(1));
  const second = pool.run(job(2));
  workers[0].complete(1);
  await first;
  await turn();
  assert.equal(workers[1].messages[0]?.type, "job");
  workers[1].complete(2);
  await second;
  await pool.destroy();
});

test("rejects a failed job, replaces its worker, and resumes dispatch", async () => {
  const { pool, workers } = createPool(1);
  await pool.start();
  const failed = pool.run(job(1));
  const queued = pool.run(job(2));
  workers[0].fail();
  await assert.rejects(failed, /worker failed/);
  await turn();
  workers[1].complete(2);
  await queued;
  await pool.destroy();
});

test("shutdown rejects both running and queued jobs", async () => {
  const { pool } = createPool(1);
  await pool.start();
  const running = pool.run(job(1));
  const queued = pool.run(job(2));
  await pool.destroy();
  await assert.rejects(running, /shut down/);
  await assert.rejects(queued, /shut down/);
  await assert.rejects(pool.run(job(3)), /shut down/);
});

test("bounds queued jobs while running work does not consume queue capacity", async () => {
  const { pool, workers } = createPool(1, { queueLimit: 2 });
  await pool.start();
  const running = pool.run(job(1));
  const queuedFirst = pool.run(job(2));
  const queuedSecond = pool.run(job(3));

  assert.equal(pool.getQueueLimit(), 2);
  assert.equal(pool.getQueueDepth(), 2);
  await assert.rejects(pool.run(job(4)), /queue is full/);
  assert.deepEqual(pool.getAdmissionMetrics(), {
    accepted: 3,
    rejected: 1,
    queuedCancelled: 0,
  });

  workers[0].complete(1);
  await running;
  workers[0].complete(2);
  await queuedFirst;
  workers[0].complete(3);
  await queuedSecond;
  await pool.destroy();
});

test("removes a queued job without disturbing FIFO dispatch or settling twice", async () => {
  const { pool, workers } = createPool(1, { queueLimit: 2 });
  await pool.start();
  const running = pool.run(job(1));
  const removed = pool.run(job(2));
  const retained = pool.run(job(3));

  assert.equal(pool.cancelQueued(2), true);
  assert.equal(pool.cancelQueued(2), false);
  await assert.rejects(removed, /was cancelled/);
  assert.equal(pool.getAdmissionMetrics().queuedCancelled, 1);
  workers[0].complete(1);
  await running;
  const dispatched = workers[0].messages.at(-1);
  assert.equal(dispatched?.type === "job" ? dispatched.job.id : undefined, 3);
  workers[0].complete(3);
  await retained;
  await pool.destroy();
});
