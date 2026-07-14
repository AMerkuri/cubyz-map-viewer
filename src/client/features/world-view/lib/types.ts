import type * as THREE from "three";
import type {
  ChunkStats,
  LoadingBreakdown,
  MapDebugSettings,
} from "../../../lib/world-view-debug.js";
import type { InitialCameraState } from "../../../types/world-view.js";
import type { VoxelWorkPriority } from "./voxel-work.js";

export type { InitialCameraState } from "../../../types/world-view.js";

import type { PlayerData } from "../hooks/usePlayers.js";
import type { WatchEvent, WatchEventType } from "../hooks/useWebSocket.js";
import type { useWorldData } from "../hooks/useWorldData.js";

export type VoxelBenchmarkCacheOutcome = "hit" | "miss" | "unknown";

/**
 * Compact worker-baked emissive attribute storage. Emissive light values are
 * clamped to `0..1`, so the worker emits them as a normalized integer typed
 * array (`Uint8Array` by default, `Uint16Array` fallback) that the main thread
 * uploads as a normalized `BufferAttribute` preserving `0..1` shader input.
 */
export type EmissiveColorArray = Uint8Array | Uint16Array;

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
  /**
   * Per-vertex mesh-local emitted-light color baked from payload-owned own-region
   * and halo LOD 1 emitter records, or null when no emitter reaches this quadrant.
   * Stored as a compact normalized integer typed array uploaded with the
   * `normalized` flag so the shader continues receiving `vec3` values in `0..1`.
   */
  emissiveColors: EmissiveColorArray | null;
  faceAo: Uint8Array;
  trianglePaletteIndices: Uint32Array;
  indices: Uint32Array;
}

export interface VoxelEmitterRecord {
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
  power: number;
  radius: number;
  halo?: boolean;
}

export interface PendingVoxelMeshItem {
  jobId: number;
  key: string;
  lod: number;
  regionX: number;
  regionY: number;
  version: number;
  quadrantMeshes: WorkerQuadrantMesh[];
  transparentQuadrantMeshes: WorkerQuadrantMesh[];
  chunkCoverage: number;
  chunkTopHeights: Float32Array;
  voxelSize: number;
  minZ: number;
  maxZ: number;
  emitterRecords: VoxelEmitterRecord[];
  haloEmitterSourceKeys: string[];
}

export interface PendingVoxelFetchRequest {
  key: string;
  lod: number;
  regionX: number;
  regionY: number;
  priority: VoxelWorkPriority;
  generation: number;
  version: number;
  selectedAt: number;
}

export interface WorkerMeshRequest {
  type: "mesh";
  jobId: number;
  buffer: ArrayBuffer;
  lod: number;
  regionX: number;
  regionY: number;
  haloEmitterRecords?: VoxelEmitterRecord[];
  haloEmitterSourceKeys?: string[];
  version: number;
  cancellationCheckpointMs: number;
  bakeEmissiveAttributes?: boolean;
  benchmark?: {
    fetchCompletedAt: number;
    fetchMs: number;
    transferBytes: number | null;
    encodedBodyBytes: number | null;
    decodedBodyBytes: number | null;
    rawBufferBytes: number;
    contentEncoding: string | null;
    serverRunMs: number | null;
    serverHaloMs: number | null;
    emitterMetadataBytes: number | null;
    emitterPowerMin: number | null;
    emitterPowerMax: number | null;
    emitterRadiusMin: number | null;
    emitterRadiusMax: number | null;
    cacheOutcome?: VoxelBenchmarkCacheOutcome;
  };
}

export interface PendingVoxelCompactInput {
  buffer: ArrayBuffer;
  lod: number;
  regionX: number;
  regionY: number;
  bakeEmissiveAttributes: boolean;
  benchmark: NonNullable<WorkerMeshRequest["benchmark"]>;
}

export interface WorkerCancelRequest {
  type: "cancel";
  jobId: number;
  version: number;
}

export type WorkerIn = WorkerMeshRequest | WorkerCancelRequest;

interface WorkerResponseIdentity {
  jobId: number;
  version: number;
  timing: {
    startedAt: number;
    completedAt: number;
  };
}

export interface WorkerMeshResult extends WorkerResponseIdentity {
  type: "mesh-result";
  lod: number;
  regionX: number;
  regionY: number;
  quadrantMeshes: WorkerQuadrantMesh[];
  transparentQuadrantMeshes: WorkerQuadrantMesh[];
  chunkCoverage: number;
  chunkTopHeights: Float32Array;
  voxelSize: number;
  minZ: number;
  maxZ: number;
  emitterRecords: VoxelEmitterRecord[];
  haloEmitterSourceKeys: string[];
  benchmark?: {
    fetchMs: number;
    decodeMs: number;
    totalMs: number;
    transferBytes: number | null;
    encodedBodyBytes: number | null;
    decodedBodyBytes: number | null;
    rawBufferBytes: number;
    workerOutputBytes: number;
    emissiveBytes: number;
    /**
     * Time spent building the emitter-light lookup grid, in milliseconds.
     * `0` when emissive attributes are disabled or no emitters are present.
     */
    emissiveGridBuildMs: number | null;
    /**
     * Time spent baking per-vertex emitted light into quadrant writers, in
     * milliseconds. `0` when emissive attributes are disabled.
     */
    emissiveBakeMs: number | null;
    /**
     * Number of opaque quads whose emissive accumulation ran because the quad
     * could intersect at least one emitter radius.
     */
    emissiveQuadsEvaluated: number;
    /**
     * Number of opaque quads conservatively skipped because their expanded
     * bounds could not intersect any emitter radius.
     */
    emissiveQuadsCulled: number;
    emissiveCandidateVisits: number;
    contentEncoding: string | null;
    serverRunMs: number | null;
    serverHaloMs: number | null;
    emitterMetadataBytes: number | null;
    emitterPowerMin: number | null;
    emitterPowerMax: number | null;
    emitterRadiusMin: number | null;
    emitterRadiusMax: number | null;
    cacheOutcome?: VoxelBenchmarkCacheOutcome;
  };
}

export interface WorkerCancelled extends WorkerResponseIdentity {
  type: "cancelled";
  lod: number;
  regionX: number;
  regionY: number;
}

export interface WorkerError extends WorkerResponseIdentity {
  type: "error";
  lod: number;
  regionX: number;
  regionY: number;
  error: string;
  benchmark?: WorkerMeshResult["benchmark"];
}

export type WorkerOut = WorkerMeshResult | WorkerCancelled | WorkerError;

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
  transparentSubMeshes: {
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
  emitterRecords: VoxelEmitterRecord[];
  haloEmitterSourceKeys: string[];
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
