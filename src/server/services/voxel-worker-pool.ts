import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type {
  VoxelJob,
  VoxelJobResult,
  VoxelWorkerData,
  VoxelWorkerDiagnostics,
  VoxelWorkerMessage,
} from "../workers/voxel-worker-protocol.js";
import type { BlockColorTable } from "./block-color-table.js";
import type { BlockShapeTable } from "./block-shape-table.js";
import { resolveVoxelWorkerCount } from "./voxel-worker-config.js";

interface PendingJob {
  job: VoxelJob;
  enqueuedAt: number;
  resolve: (result: InstrumentedPoolResult) => void;
  reject: (error: Error) => void;
}

export interface InstrumentedPoolResult {
  result: VoxelJobResult;
  queueMs: number;
  runMs: number;
}

export interface VoxelWorkerLike {
  postMessage(message: VoxelWorkerMessage): void;
  terminate(): Promise<number>;
  on(event: "message", listener: (result: VoxelJobResult) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "exit", listener: (code: number) => void): this;
}

export interface VoxelWorkerPoolOptions {
  representedEmitterCacheMaxEntries?: number;
  representedEmitterCacheMaxSources?: number;
  recycleHeapBytes?: number;
  recycleExternalBytes?: number;
  recycleArrayBufferBytes?: number;
  recycleCompletedJobs?: number;
  workerFactory?: (data: VoxelWorkerData) => VoxelWorkerLike;
}

export interface VoxelWorkerPoolDiagnostics {
  slots: VoxelWorkerDiagnostics[];
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
  representedEmitterCacheEntries: number;
  representedEmitterCacheSources: number;
  representedEmitterInFlight: number;
  retirements: number;
  retirementReasons: Record<string, number>;
}

interface WorkerSlot {
  worker: VoxelWorkerLike;
  busy: boolean;
  currentJobId: number | null;
  currentJobStartedAt: number;
  diagnostics?: VoxelWorkerDiagnostics;
  retirementReason?: string;
  replacing: boolean;
}

type VoxelWorkerRuntimeMode = "source" | "dist";

const DEFAULT_EMITTER_CACHE_ENTRIES = 64;
const DEFAULT_EMITTER_CACHE_SOURCES = 16_384;

export class VoxelWorkerPool {
  private readonly workerData: VoxelWorkerData;
  private readonly size: number;
  private readonly options: VoxelWorkerPoolOptions;
  private readonly workers: WorkerSlot[] = [];
  private readonly queue: PendingJob[] = [];
  private readonly runningJobs = new Map<number, PendingJob>();
  private readonly retirementReasons = new Map<string, number>();
  private routineRetirementActive = false;
  private retirements = 0;
  private shuttingDown = false;

  constructor(
    savePath: string,
    blockColors: BlockColorTable,
    blockShapes: BlockShapeTable,
    size?: number,
    options: VoxelWorkerPoolOptions = {},
  ) {
    this.options = options;
    this.workerData = {
      savePath,
      blockColors,
      blockShapes,
      representedEmitterCacheMaxEntries:
        options.representedEmitterCacheMaxEntries ??
        DEFAULT_EMITTER_CACHE_ENTRIES,
      representedEmitterCacheMaxSources:
        options.representedEmitterCacheMaxSources ??
        DEFAULT_EMITTER_CACHE_SOURCES,
    };
    this.size = Math.max(1, size ?? resolveVoxelWorkerCount(undefined));
  }

  async start(): Promise<void> {
    this.shuttingDown = false;
    for (let i = this.workers.length; i < this.size; i++) {
      this.workers.push(this.createWorkerSlot());
    }
  }

  async destroy(): Promise<void> {
    this.shuttingDown = true;
    const error = new Error("Voxel worker pool shut down");
    for (const pending of this.queue.splice(0)) pending.reject(error);
    for (const pending of this.runningJobs.values()) pending.reject(error);
    this.runningJobs.clear();
    const slots = this.workers.splice(0);
    await Promise.all(
      slots.map((slot) => slot.worker.terminate().catch(() => undefined)),
    );
    this.routineRetirementActive = false;
  }

  run(job: VoxelJob): Promise<InstrumentedPoolResult> {
    if (this.shuttingDown) {
      return Promise.reject(new Error("Voxel worker pool is shut down"));
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ job, enqueuedAt: performance.now(), resolve, reject });
      this.dispatch();
    });
  }

  getWorkerCount(): number {
    return this.workers.length;
  }

  getQueueDepth(): number {
    return this.queue.length;
  }

  getRunningCount(): number {
    return this.runningJobs.size;
  }

  getRuntimeMode(): VoxelWorkerRuntimeMode {
    return this.isSourceRuntime() ? "source" : "dist";
  }

  getDiagnosticsSnapshot(): VoxelWorkerPoolDiagnostics {
    const slots = this.workers.flatMap((slot) =>
      slot.diagnostics ? [slot.diagnostics] : [],
    );
    return {
      slots,
      heapUsed: slots.reduce((sum, value) => sum + value.heapUsed, 0),
      heapTotal: slots.reduce((sum, value) => sum + value.heapTotal, 0),
      external: slots.reduce((sum, value) => sum + value.external, 0),
      arrayBuffers: slots.reduce((sum, value) => sum + value.arrayBuffers, 0),
      representedEmitterCacheEntries: slots.reduce(
        (sum, value) => sum + value.representedEmitterCacheEntries,
        0,
      ),
      representedEmitterCacheSources: slots.reduce(
        (sum, value) => sum + value.representedEmitterCacheSources,
        0,
      ),
      representedEmitterInFlight: slots.reduce(
        (sum, value) => sum + value.representedEmitterInFlight,
        0,
      ),
      retirements: this.retirements,
      retirementReasons: Object.fromEntries(this.retirementReasons),
    };
  }

  private dispatch(): void {
    if (this.shuttingDown) return;
    this.startEligibleRetirement();
    for (const slot of this.workers) {
      if (slot.busy || slot.replacing || slot.retirementReason) continue;
      const pending = this.queue.shift();
      if (!pending) return;
      slot.busy = true;
      slot.currentJobId = pending.job.id;
      slot.currentJobStartedAt = performance.now();
      this.runningJobs.set(pending.job.id, pending);
      try {
        slot.worker.postMessage({ type: "job", job: pending.job });
      } catch (error) {
        this.failSlot(
          slot,
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }
  }

  private createWorkerSlot(): WorkerSlot {
    const worker = this.createWorker();
    const slot: WorkerSlot = {
      worker,
      busy: false,
      currentJobId: null,
      currentJobStartedAt: 0,
      replacing: false,
    };

    worker.on("message", (result) => {
      if (slot.replacing || this.shuttingDown) return;
      const pending = this.runningJobs.get(result.id);
      if (!pending || slot.currentJobId !== result.id) return;
      this.runningJobs.delete(result.id);
      const queueMs = slot.currentJobStartedAt - pending.enqueuedAt;
      slot.busy = false;
      slot.currentJobId = null;
      slot.currentJobStartedAt = 0;
      slot.diagnostics = result.diagnostics;
      slot.retirementReason = this.getRetirementReason(result.diagnostics);
      pending.resolve({ result, queueMs, runMs: result.runMs });
      this.dispatch();
    });

    worker.on("error", (error) => this.failSlot(slot, error));
    worker.on("exit", (code) => {
      if (!slot.replacing && !this.shuttingDown) {
        this.failSlot(slot, new Error(`Voxel worker exited with code ${code}`));
      }
    });
    return slot;
  }

  private failSlot(slot: WorkerSlot, error: Error): void {
    if (slot.replacing || this.shuttingDown) return;
    const jobId = slot.currentJobId;
    if (jobId !== null) {
      const pending = this.runningJobs.get(jobId);
      this.runningJobs.delete(jobId);
      pending?.reject(error);
    }
    void this.replaceSlot(slot, false);
  }

  private startEligibleRetirement(): void {
    if (this.routineRetirementActive || this.shuttingDown) return;
    const slot = this.workers.find(
      (candidate) =>
        !candidate.busy && !candidate.replacing && candidate.retirementReason,
    );
    if (!slot) return;
    this.routineRetirementActive = true;
    void this.replaceSlot(slot, true);
  }

  private async replaceSlot(slot: WorkerSlot, routine: boolean): Promise<void> {
    if (slot.replacing) return;
    slot.replacing = true;
    const index = this.workers.indexOf(slot);
    if (index === -1) return;
    if (routine && slot.retirementReason) {
      this.retirements++;
      this.retirementReasons.set(
        slot.retirementReason,
        (this.retirementReasons.get(slot.retirementReason) ?? 0) + 1,
      );
    }
    await slot.worker.terminate().catch(() => undefined);
    if (!this.shuttingDown && this.workers[index] === slot) {
      this.workers[index] = this.createWorkerSlot();
    }
    if (routine) this.routineRetirementActive = false;
    this.dispatch();
  }

  private getRetirementReason(
    diagnostics: VoxelWorkerDiagnostics,
  ): string | undefined {
    if (
      this.options.recycleHeapBytes &&
      diagnostics.heapUsed >= this.options.recycleHeapBytes
    )
      return "heap";
    if (
      this.options.recycleExternalBytes &&
      diagnostics.external >= this.options.recycleExternalBytes
    )
      return "external";
    if (
      this.options.recycleArrayBufferBytes &&
      diagnostics.arrayBuffers >= this.options.recycleArrayBufferBytes
    )
      return "arrayBuffers";
    if (
      this.options.recycleCompletedJobs &&
      diagnostics.completedJobs >= this.options.recycleCompletedJobs
    )
      return "completedJobs";
    return undefined;
  }

  private createWorker(): VoxelWorkerLike {
    if (this.options.workerFactory)
      return this.options.workerFactory(this.workerData);
    const url = this.isSourceRuntime()
      ? new URL("../workers/voxel-worker-dev.js", import.meta.url)
      : new URL("../workers/voxel-worker.js", import.meta.url);
    return new Worker(url, { workerData: this.workerData });
  }

  private isSourceRuntime(): boolean {
    return fileURLToPath(import.meta.url).endsWith(".ts");
  }
}
