import type * as THREE from "three";
import type { MapDebugSettings } from "../debug.js";
import type { PlayerData } from "../hooks/usePlayers.js";
import type { WatchEvent, WatchEventType } from "../hooks/useWebSocket.js";
import type { useWorldData } from "../hooks/useWorldData.js";

export interface TerrainMeshData {
  width: number;
  height: number;
  heights: number[];
  colors: number[];
  worldX: number;
  worldY: number;
  voxelSize: number;
  minHeight: number;
  maxHeight: number;
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
  colors: Float32Array;
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
  borderLines: THREE.LineSegments;
  borderLabel: THREE.Sprite;
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
  lastHitAt: number;
  initialized: boolean;
}

export interface InitialCameraState {
  pos: [number, number, number];
  zoom: number;
  theta: number;
  phi: number;
}

export interface World3DViewProps {
  mode: "terrain" | "voxel";
  worldData: ReturnType<typeof useWorldData>;
  players: PlayerData[];
  subscribe: (
    type: WatchEventType,
    handler: (event: WatchEvent) => void,
  ) => () => void;
  showPlayers: boolean;
  showSpawn: boolean;
  showChunkBorders: boolean;
  showTerrain: boolean;
  showVoxelTerrain: boolean;
  showBiomeLabels: boolean;
  showVoxelHeightLabels: boolean;
  renderDistance: number;
  voxelLod1MaxDist: number;
  minRenderedVoxelLod: number;
  debugEnabled: boolean;
  debugSettings: MapDebugSettings;
  onCursorMove: (pos: [number, number, number] | null) => void;
  onPlayerClick: (player: PlayerData) => void;
  onChunkStatsChange: (stats: import("../debug.js").ChunkStats) => void;
  onVoxelLoadingChange: (loading: boolean) => void;
  initialCameraState: InitialCameraState | null;
  onShareStateChange: (state: {
    mode: "terrain" | "voxel";
    pos: [number, number, number];
    zoom: number;
    theta: number;
    phi: number;
  }) => void;
  flyToRequest: { pos: [number, number, number]; key: number } | null;
}
