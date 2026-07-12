import type {
  VoxelEmitterSummaryServiceLike,
  VoxelWorkerPoolLike,
} from "../../../src/server/services/voxel-mesh-service.js";
import type { InstrumentedPoolResult } from "../../../src/server/services/voxel-worker-pool.js";
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

export class DeferredVoxelPool implements VoxelWorkerPoolLike {
  readonly jobs: VoxelJob[] = [];
  private readonly completions = new Map<
    number,
    ReturnType<typeof createDeferred<InstrumentedPoolResult>>
  >();

  async start(): Promise<void> {}
  async destroy(): Promise<void> {}

  run(job: VoxelJob): Promise<InstrumentedPoolResult> {
    this.jobs.push(job);
    const completion = createDeferred<InstrumentedPoolResult>();
    this.completions.set(job.id, completion);
    return completion.promise;
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
        stats,
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
    return 0;
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

  async getNode(): ReturnType<VoxelEmitterSummaryServiceLike["getNode"]> {
    throw new Error("LOD 1 tests do not request emitter summaries");
  }

  invalidate(lod: number, regionX: number, regionY: number): void {
    this.invalidations.push({ lod, regionX, regionY });
  }
}
