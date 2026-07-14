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
  };
}

class FakeWorker implements VoxelWorkerLike {
  readonly messages: VoxelWorkerMessage[] = [];
  terminateCalls = 0;
  private readonly listeners = {
    message: [] as Array<(result: VoxelJobResult) => void>,
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

  on(event: "message", listener: (result: VoxelJobResult) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "exit", listener: (code: number) => void): this;
  on(
    event: "message" | "error" | "exit",
    listener:
      | ((result: VoxelJobResult) => void)
      | ((error: Error) => void)
      | ((code: number) => void),
  ): this {
    (this.listeners[event] as Array<typeof listener>).push(listener);
    return this;
  }

  complete(id: number, memory = diagnostics()): void {
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
      diagnostics: memory,
    };
    for (const listener of this.listeners.message) listener(result);
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

test("keeps workers reusable when recycling thresholds are disabled", async () => {
  const { pool, workers } = createPool(1);
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
