import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type {
  VoxelJob,
  VoxelJobResult,
  VoxelWorkerData,
  VoxelWorkerMessage,
} from "../workers/voxel-worker-protocol.js";
import type { BlockColorTable } from "./block-color-table.js";

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

interface WorkerSlot {
  worker: Worker;
  busy: boolean;
  currentJobId: number | null;
  currentJobStartedAt: number;
}

type VoxelWorkerRuntimeMode = "source" | "dist";

export class VoxelWorkerPool {
  private readonly workerData: VoxelWorkerData;
  private readonly size: number;
  private readonly workers: WorkerSlot[] = [];
  private readonly queue: PendingJob[] = [];
  private readonly runningJobs = new Map<number, PendingJob>();

  constructor(savePath: string, blockColors: BlockColorTable, size?: number) {
    this.workerData = { savePath, blockColors };
    const parallelism = Math.max(1, availableParallelism());
    this.size = Math.max(1, size ?? Math.floor(parallelism / 2));
  }

  async start(): Promise<void> {
    for (let i = 0; i < this.size; i++) {
      this.workers.push(this.createWorkerSlot());
    }
  }

  async destroy(): Promise<void> {
    const terminations = this.workers.map((slot) =>
      slot.worker.terminate().catch(() => undefined),
    );
    this.workers.length = 0;
    this.queue.length = 0;
    this.runningJobs.clear();
    await Promise.all(terminations);
  }

  run(job: VoxelJob): Promise<InstrumentedPoolResult> {
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

  private dispatch(): void {
    for (const slot of this.workers) {
      if (slot.busy) continue;
      const pending = this.queue.shift();
      if (!pending) return;
      slot.busy = true;
      slot.currentJobId = pending.job.id;
      slot.currentJobStartedAt = performance.now();
      this.runningJobs.set(pending.job.id, pending);
      const message: VoxelWorkerMessage = { type: "job", job: pending.job };
      slot.worker.postMessage(message);
    }
  }

  private createWorkerSlot(): WorkerSlot {
    const worker = this.createWorker();
    const slot: WorkerSlot = {
      worker,
      busy: false,
      currentJobId: null,
      currentJobStartedAt: 0,
    };

    worker.on("message", (result: VoxelJobResult) => {
      const pending = this.runningJobs.get(result.id);
      if (!pending) return;
      this.runningJobs.delete(result.id);
      const queueMs = slot.currentJobStartedAt - pending.enqueuedAt;
      slot.busy = false;
      slot.currentJobId = null;
      slot.currentJobStartedAt = 0;
      pending.resolve({ result, queueMs, runMs: result.runMs });
      this.dispatch();
    });

    worker.on("error", (error) => {
      const jobId = slot.currentJobId;
      if (jobId !== null) {
        const pending = this.runningJobs.get(jobId);
        if (pending) {
          this.runningJobs.delete(jobId);
          pending.reject(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      }
      slot.busy = false;
      slot.currentJobId = null;
      slot.currentJobStartedAt = 0;
    });

    worker.on("exit", (code) => {
      if (code !== 0 && this.workers.includes(slot)) {
        const jobId = slot.currentJobId;
        if (jobId !== null) {
          const pending = this.runningJobs.get(jobId);
          if (pending) {
            this.runningJobs.delete(jobId);
            pending.reject(new Error(`Voxel worker exited with code ${code}`));
          }
        }
        const index = this.workers.indexOf(slot);
        if (index !== -1) {
          this.workers[index] = this.createWorkerSlot();
        }
        this.dispatch();
      }
    });

    return slot;
  }

  private createWorker(): Worker {
    const isSourceRuntime = this.isSourceRuntime();
    if (!isSourceRuntime) {
      return new Worker(
        new URL("../workers/voxel-worker.js", import.meta.url),
        {
          workerData: this.workerData,
        },
      );
    }

    return new Worker(
      new URL("../workers/voxel-worker-dev.js", import.meta.url),
      {
        workerData: this.workerData,
      },
    );
  }

  private isSourceRuntime(): boolean {
    return fileURLToPath(import.meta.url).endsWith(".ts");
  }
}
