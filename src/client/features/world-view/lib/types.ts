import type * as THREE from "three";
import type {
  ChunkStats,
  LoadingBreakdown,
  MapDebugSettings,
} from "../../../lib/world-view-debug.js";
import type { InitialCameraState } from "../../../types/world-view.js";

export type { InitialCameraState } from "../../../types/world-view.js";

import type { PlayerData } from "../hooks/usePlayers.js";
import type { WatchEvent, WatchEventType } from "../hooks/useWebSocket.js";
import type { useWorldData } from "../hooks/useWorldData.js";

export interface TerrainMeshData {
  meshWidth: number;
  meshHeight: number;
  sampleWidth: number;
  sampleHeight: number;
  gutter: number;
  stepWorld: number;
  heights: number[];
  colors: number[];
  worldX: number;
  worldY: number;
  voxelSize: number;
  minHeight: number;
  maxHeight: number;
}

export interface PendingTerrainFetchRequest {
  key: string;
  lod: number;
  tileX: number;
  tileY: number;
  priority: number;
  generation: number;
}

export interface PendingTerrainMeshItem {
  key: string;
  lod: number;
  tileX: number;
  tileY: number;
  generation: number;
  meshData: TerrainMeshData;
}

export interface BiomesResponse {
  tileX: number;
  tileY: number;
  lod: number;
  regions: {
    biomeName: string;
    centerX: number;
    centerY: number;
    count: number;
  }[];
}

export interface WorkerQuadrantMesh {
  quadrantIndex: number;
  positions: Float32Array;
  normals: Float32Array;
  baseColors: Float32Array;
  faceAo: Uint8Array;
  trianglePaletteIndices: Uint32Array;
  indices: Uint32Array;
}

export interface PendingVoxelMeshItem {
  key: string;
  lod: number;
  regionX: number;
  regionY: number;
  version: number;
  quadrantMeshes: WorkerQuadrantMesh[];
  chunkCoverage: number;
  chunkTopHeights: Float32Array;
  voxelSize: number;
  minZ: number;
  maxZ: number;
}

export interface PendingVoxelFetchRequest {
  key: string;
  lod: number;
  regionX: number;
  regionY: number;
  priority: number;
  generation: number;
  version: number;
}

export interface WorkerIn {
  buffer: ArrayBuffer;
  lod: number;
  regionX: number;
  regionY: number;
  version?: number;
  benchmark?: {
    fetchCompletedAt: number;
    fetchMs: number;
    transferBytes: number | null;
    encodedBodyBytes: number | null;
    decodedBodyBytes: number | null;
    rawBufferBytes: number;
    contentEncoding: string | null;
  };
}

export interface WorkerOut {
  lod?: number;
  regionX: number;
  regionY: number;
  version?: number;
  quadrantMeshes?: WorkerQuadrantMesh[];
  chunkCoverage?: number;
  chunkTopHeights?: Float32Array;
  voxelSize?: number;
  minZ?: number;
  maxZ?: number;
  benchmark?: {
    fetchMs: number;
    decodeMs: number;
    totalMs: number;
    transferBytes: number | null;
    encodedBodyBytes: number | null;
    decodedBodyBytes: number | null;
    rawBufferBytes: number;
    contentEncoding: string | null;
  };
  error?: string;
}

export interface LoadedTerrainTile {
  key: string;
  lod: number;
  tileX: number;
  tileY: number;
  worldX: number;
  worldY: number;
  mesh: THREE.Mesh;
  borderLines: THREE.LineSegments | null;
  borderLabel: THREE.Sprite | null;
}

export interface WarmCachedTerrainTile {
  tile: LoadedTerrainTile;
  bytes: number;
}

export interface LoadedVoxelTile {
  key: string;
  lod: number;
  regionX: number;
  regionY: number;
  voxelSize: number;
  subMeshes: {
    quadrantIndex: number;
    mesh: THREE.Mesh;
    baseColors: Float32Array;
    faceAo: Uint8Array;
    trianglePaletteIndices: Uint32Array;
    aoBoundarySignature: string;
  }[];
  minZ: number;
  maxZ: number;
  chunkCoverage: number;
  chunkTopHeights: Float32Array;
  borderLines: THREE.LineSegments;
}

export interface WarmCachedVoxelTile {
  tile: LoadedVoxelTile;
  bytes: number;
}

export interface VoxelRefreshState {
  version: number;
  stale: boolean;
}

export interface PerformanceMemoryInfo {
  usedJSHeapSize: number;
}

export interface VoxelFocusState {
  point: THREE.Vector3;
  zoomDist: number;
  lastSampleAt: number;
  initialized: boolean;
}

export interface CursorHoverInfo {
  pos: [number, number, number];
  blockId?: string;
  voxelChunkLod?: number;
  voxelRegion?: [number, number];
}

export interface World3DViewProps {
  worldData: ReturnType<typeof useWorldData>;
  players: PlayerData[];
  subscribe: (
    type: WatchEventType,
    handler: (event: WatchEvent) => void,
  ) => () => void;
  showPlayers: boolean;
  showSpawn: boolean;
  showChunkBorders: boolean;
  showTerrainUnderlay: boolean;
  showBiomeLabels: boolean;
  showVoxelHeightLabels: boolean;
  renderDistance: number;
  voxelLod1MaxDist: number;
  minRenderedVoxelLod: number;
  debugEnabled: boolean;
  debugSettings: MapDebugSettings;
  onCursorMove: (info: CursorHoverInfo | null) => void;
  onPlayerClick: (player: PlayerData) => void;
  onChunkStatsChange: (stats: ChunkStats) => void;
  onLoadingBreakdownChange: (loadingBreakdown: LoadingBreakdown) => void;
  initialCameraState: InitialCameraState | null;
  onShareStateChange: (state: {
    pos: [number, number, number];
    zoom: number;
    theta: number;
    phi: number;
  }) => void;
  flyToRequest: {
    pos: [number, number, number];
    preserveHeight: boolean;
    key: number;
  } | null;
}
