import type { BlockColorTable } from "../services/block-color-table.js";
import type { BlockShapeTable } from "../services/block-shape-table.js";
import type {
  EmitterSummaryBuildMetrics,
  EmitterSummaryNode,
} from "../services/voxel-emitter-aggregation.js";

export interface VoxelWorkerData {
  savePath: string;
  blockColors: BlockColorTable;
  blockShapes: BlockShapeTable;
  representedEmitterCacheMaxEntries: number;
  representedEmitterCacheMaxSources: number;
}

export interface VoxelWorkerDiagnostics {
  phase: "pre-transfer" | "idle";
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
  completedJobs: number;
  representedEmitterCacheEntries: number;
  representedEmitterCacheSources: number;
  representedEmitterInFlight: number;
}

export interface VoxelJob {
  id: number;
  key: string;
  lod: number;
  regionX: number;
  regionY: number;
  globalEpoch: number;
  keyEpoch: number;
  /**
   * Debug-only voxel-lighting diagnostic. When false, LOD 1 payload
   * generation omits neighboring-region halo emitter collection and bypasses
   * the persistent voxel cache. Defaults to true (normal behavior).
   */
  includeHaloEmitters?: boolean;
  emitterSummary?: EmitterSummaryNode;
  emitterSummaryMetrics?: EmitterSummaryBuildMetrics;
}

export interface VoxelGenerationStats {
  cacheTier: "worker" | "disk";
  quadCount: number;
  greedyCubeQuads: number;
  modelQuads: number;
  droppedModelQuads: number;
  modelQuadBudget: number;
  transparentQuads: number;
  rawPayloadBytes: number;
  greedyRecordBytes: number;
  modelRecordBytes: number;
  emitterRecords: number;
  ownEmitterRecords?: number;
  haloEmitterRecords?: number;
  aggregatedEmitterRecords?: number;
  /** Time spent collecting neighboring-region halo emitter records, in ms. */
  haloMs?: number;
  emitterRecordBytes: number;
  emitterMetadataBytes?: number;
  emitterPowerMin?: number;
  emitterPowerMax?: number;
  emitterRadiusMin?: number;
  emitterRadiusMax?: number;
  summaryCacheOutcome?: EmitterSummaryBuildMetrics["cacheOutcome"];
  summaryBuildMs?: number;
  summaryLeafParses?: number;
  summaryRawSourceCount?: number;
  summaryRetainedClusterCount?: number;
  summaryCappedClusterCount?: number;
  chunkColumns: number;
  regionsParsed: number;
  chunksMeshed: number;
  visitedAirCells: number;
  facesBeforeMerge: number;
  /**
   * Aggregate external (neighboring-column) region cache behavior for a single
   * generation job. `externalRegionParses` counts distinct `.region` files
   * parsed for external chunk access, `externalRegionCacheHits` counts reuse of
   * an already-loading/loaded external region, `externalRegionMisses` counts
   * external region files that did not exist, and `externalRegionParseErrors`
   * counts external region parse failures. Disk-cache-tier results report 0
   * because no worker generation runs.
   */
  externalRegionParses?: number;
  externalRegionCacheHits?: number;
  externalRegionMisses?: number;
  externalRegionParseErrors?: number;
  minWorldZ: number;
  maxWorldZ: number;
}

type VoxelJobResultBase = {
  id: number;
  key: string;
  globalEpoch: number;
  keyEpoch: number;
  runMs: number;
  preTransferDiagnostics: VoxelWorkerDiagnostics;
};

export type VoxelJobResult = VoxelJobResultBase &
  (
    | {
        status: "ok";
        buffer: ArrayBuffer;
        stats: VoxelGenerationStats;
      }
    | {
        status: "empty";
        stats?: VoxelGenerationStats;
      }
    | {
        status: "error";
        error: string;
        stats?: VoxelGenerationStats;
      }
  );

export interface VoxelWorkerIdleMessage {
  type: "idle";
  id: number;
  diagnostics: VoxelWorkerDiagnostics;
}

export type VoxelWorkerResponseMessage =
  | VoxelJobResult
  | VoxelWorkerIdleMessage;

export interface VoxelWorkerRequestMessage {
  type: "job";
  job: VoxelJob;
}

export interface VoxelWorkerShutdownMessage {
  type: "shutdown";
}

export type VoxelWorkerMessage =
  | VoxelWorkerRequestMessage
  | VoxelWorkerShutdownMessage;
