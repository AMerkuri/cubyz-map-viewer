import type {
  VoxelEmitterSummaryServiceLike,
  VoxelWorkerPoolLike,
} from "../../../src/server/services/voxel-mesh-service.js";
import type { InstrumentedPoolResult } from "../../../src/server/services/voxel-worker-pool.js";
import { VoxelQueuedJobCancelledError } from "../../../src/server/services/voxel-worker-pool.js";
import type {
  VoxelGenerationStats,
  VoxelJob,
} from "../../../src/server/workers/voxel-worker-protocol.js";
import { createDeferred } from "./deferred.js";

const stats: VoxelGenerationStats = {
  cacheTier: "worker",
  quadCount: 1,
  greedyCubeQuads: 1,
  modelQuads: 0,
  droppedModelQuads: 0,
  modelQuadBudget: 0,
  transparentQuads: 0,
  rawPayloadBytes: 1,
  greedyRecordBytes: 1,
  modelRecordBytes: 0,
  emitterRecords: 0,
  emitterRecordBytes: 0,
  chunkColumns: 1,
  regionsParsed: 1,
  chunksMeshed: 1,
  visitedAirCells: 1,
  facesBeforeMerge: 1,
  minWorldZ: 0,
  maxWorldZ: 0,
};

const diagnostics = {
  phase: "pre-transfer" as const,
  heapUsed: 0,
  heapTotal: 0,
  external: 0,
  arrayBuffers: 0,
  completedJobs: 1,
  representedEmitterCacheEntries: 0,
  representedEmitterCacheSources: 0,
  representedEmitterInFlight: 0,
};

export class DeferredVoxelPool implements VoxelWorkerPoolLike {
  readonly jobs: VoxelJob[] = [];
  readonly queuedJobIds = new Set<number>();
  readonly cancelledJobIds: number[] = [];
  admissionAccepted = 0;
  admissionRejected = 0;
  private readonly completions = new Map<
    number,
    ReturnType<typeof createDeferred<InstrumentedPoolResult>>
  >();

  async start(): Promise<void> {}
  async destroy(): Promise<void> {}

  run(job: VoxelJob): Promise<InstrumentedPoolResult> {
    this.admissionAccepted++;
    this.jobs.push(job);
    const completion = createDeferred<InstrumentedPoolResult>();
    this.completions.set(job.id, completion);
    return completion.promise;
  }

  cancelQueued(jobId: number): boolean {
    if (!this.queuedJobIds.delete(jobId)) return false;
    this.cancelledJobIds.push(jobId);
    this.completions.get(jobId)?.reject(new VoxelQueuedJobCancelledError());
    return true;
  }

  complete(job: VoxelJob, payload = Buffer.from([1, 2, 3])): void {
    this.completions.get(job.id)?.resolve({
      result: {
        ...job,
        status: "ok",
        buffer: payload.buffer.slice(
          payload.byteOffset,
          payload.byteOffset + payload.byteLength,
        ),
        runMs: 1,
        preTransferDiagnostics: diagnostics,
        stats,
      },
      queueMs: 0,
      runMs: 1,
    });
  }

  fail(job: VoxelJob, error = "generation failed"): void {
    this.completions.get(job.id)?.resolve({
      result: {
        ...job,
        status: "error",
        error,
        runMs: 1,
        preTransferDiagnostics: diagnostics,
      },
      queueMs: 0,
      runMs: 1,
    });
  }

  getWorkerCount(): number {
    return 1;
  }
  getRuntimeMode(): "source" | "dist" {
    return "source";
  }
  getQueueDepth(): number {
    return this.queuedJobIds.size;
  }
  getQueueLimit(): number {
    return 32;
  }
  getAdmissionMetrics() {
    return {
      accepted: this.admissionAccepted,
      rejected: this.admissionRejected,
      queuedCancelled: this.cancelledJobIds.length,
    };
  }
  getDiagnosticsSnapshot() {
    const idle = { ...diagnostics, phase: "idle" as const };
    return {
      slots: [idle],
      preTransferSlots: [diagnostics],
      heapUsed: idle.heapUsed,
      heapTotal: idle.heapTotal,
      external: idle.external,
      arrayBuffers: idle.arrayBuffers,
      preTransferHeapUsed: diagnostics.heapUsed,
      preTransferExternal: diagnostics.external,
      preTransferArrayBuffers: diagnostics.arrayBuffers,
      representedEmitterCacheEntries: 0,
      representedEmitterCacheSources: 0,
      representedEmitterInFlight: 0,
      retirements: 0,
      retirementReasons: {},
    };
  }
  getRunningCount(): number {
    return this.jobs.length - [...this.completions.values()].length;
  }
}

export class RecordingEmitterSummaries
  implements VoxelEmitterSummaryServiceLike
{
  readonly invalidations: Array<{
    lod: number;
    regionX: number;
    regionY: number;
  }> = [];
  clearCount = 0;
  metrics = {
    entries: 0,
    estimatedBytes: 0,
    retainedClusters: 0,
    evictions: 0,
    oversizedSkips: 0,
    activeWork: 0,
    nodeRequests: 0,
    nodeMemoryHits: 0,
    nodeDiskHits: 0,
    nodeBuilds: 0,
    leafExtractions: 0,
    extractedSources: 0,
    leafBuildLimit: 1,
    leafBuildActive: 0,
    leafBuildQueued: 0,
  };

  async getNode(): ReturnType<VoxelEmitterSummaryServiceLike["getNode"]> {
    throw new Error("LOD 1 tests do not request emitter summaries");
  }

  invalidate(lod: number, regionX: number, regionY: number): void {
    this.invalidations.push({ lod, regionX, regionY });
  }

  clear(): void {
    this.clearCount++;
  }

  getMetricsSnapshot() {
    return this.metrics;
  }
}
