import type { BlockColorTable } from "../services/block-color-table.js";
import type { BlockShapeTable } from "../services/block-shape-table.js";

export interface VoxelWorkerData {
  savePath: string;
  blockColors: BlockColorTable;
  blockShapes: BlockShapeTable;
}

export interface VoxelJob {
  id: number;
  key: string;
  lod: number;
  regionX: number;
  regionY: number;
  globalEpoch: number;
  keyEpoch: number;
}

export interface VoxelGenerationStats {
  cacheTier: "worker" | "disk";
  quadCount: number;
  chunkColumns: number;
  regionsParsed: number;
  chunksMeshed: number;
  visitedAirCells: number;
  facesBeforeMerge: number;
  minWorldZ: number;
  maxWorldZ: number;
}

export type VoxelJobResult =
  | {
      id: number;
      key: string;
      globalEpoch: number;
      keyEpoch: number;
      status: "ok";
      buffer: ArrayBuffer;
      runMs: number;
      stats: VoxelGenerationStats;
    }
  | {
      id: number;
      key: string;
      globalEpoch: number;
      keyEpoch: number;
      status: "empty";
      runMs: number;
      stats?: VoxelGenerationStats;
    }
  | {
      id: number;
      key: string;
      globalEpoch: number;
      keyEpoch: number;
      status: "error";
      error: string;
      runMs: number;
      stats?: VoxelGenerationStats;
    };

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
