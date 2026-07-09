import type { ChunkStats } from "../../../lib/world-view-debug.js";
import type { BlockLightRuntimeStats } from "./block-light-runtime.js";
import {
  addMemoryToLod,
  estimateLoadedTerrainTileBytes,
  estimateLoadedVoxelTileMemory,
} from "./memory.js";
import type {
  LoadedTerrainTile,
  LoadedVoxelTile,
  PendingVoxelFetchRequest,
  PendingVoxelMeshItem,
  PerformanceMemoryInfo,
  WarmCachedTerrainTile,
  WarmCachedVoxelTile,
} from "./types.js";

export interface RollingVoxelBenchmarkStats {
  samples: number;
  contentEncoding: string | null;
  avgFetchMs: number;
  avgDecodeMs: number;
  avgTotalMs: number;
  avgTransferBytes: number | null;
  avgEncodedBodyBytes: number | null;
  avgDecodedBodyBytes: number | null;
  avgRawBufferBytes: number | null;
  avgWorkerOutputBytes: number | null;
  avgEmissiveBytes: number | null;
  avgEmissiveGridBuildMs: number | null;
  avgEmissiveBakeMs: number | null;
  avgEmissiveQuadsEvaluated: number | null;
  avgEmissiveQuadsCulled: number | null;
  avgServerRunMs: number | null;
  avgServerHaloMs: number | null;
  cacheHitSamples: number;
  cacheMissSamples: number;
  cacheUnknownSamples: number;
  haloEmittersEnabled: boolean;
  emissiveAttributesEnabled: boolean;
}

export function createEmptyVoxelBenchmarkStats(
  haloEmittersEnabled: boolean,
  emissiveAttributesEnabled: boolean,
): RollingVoxelBenchmarkStats {
  return {
    samples: 0,
    contentEncoding: null,
    avgFetchMs: 0,
    avgDecodeMs: 0,
    avgTotalMs: 0,
    avgTransferBytes: null,
    avgEncodedBodyBytes: null,
    avgDecodedBodyBytes: null,
    avgRawBufferBytes: null,
    avgWorkerOutputBytes: null,
    avgEmissiveBytes: null,
    avgEmissiveGridBuildMs: null,
    avgEmissiveBakeMs: null,
    avgEmissiveQuadsEvaluated: null,
    avgEmissiveQuadsCulled: null,
    avgServerRunMs: null,
    avgServerHaloMs: null,
    cacheHitSamples: 0,
    cacheMissSamples: 0,
    cacheUnknownSamples: 0,
    haloEmittersEnabled,
    emissiveAttributesEnabled,
  };
}

export function publishChunkStats(args: {
  fpsValue: number;
  activeFocusLod: number;
  loadingTerrain: Set<string>;
  loadingVoxels: Set<string>;
  pendingVoxelFetchQueue: PendingVoxelFetchRequest[];
  pendingVoxelMeshQueue: PendingVoxelMeshItem[];
  missingVoxels: Set<string>;
  failedVoxels: Map<string, number>;
  loadedTerrain: Map<string, LoadedTerrainTile>;
  loadedVoxels: Map<string, LoadedVoxelTile>;
  warmCachedTerrain: Map<string, WarmCachedTerrainTile>;
  warmCachedVoxels: Map<string, WarmCachedVoxelTile>;
  voxelBenchmark: RollingVoxelBenchmarkStats;
  blockLightStats: BlockLightRuntimeStats;
  lastChunkStatsRef: { current: string };
  onChunkStatsChange: (stats: ChunkStats) => void;
}): void {
  const {
    fpsValue,
    activeFocusLod,
    loadingTerrain,
    loadingVoxels,
    pendingVoxelFetchQueue,
    pendingVoxelMeshQueue,
    missingVoxels,
    failedVoxels,
    loadedTerrain,
    loadedVoxels,
    warmCachedTerrain,
    warmCachedVoxels,
    voxelBenchmark,
    blockLightStats,
    lastChunkStatsRef,
    onChunkStatsChange,
  } = args;

  const loadingTerrainCount = loadingTerrain.size;
  const loadingVoxelCount = loadingVoxels.size;
  const fetchQueueCount = pendingVoxelFetchQueue.length;
  const meshQueueCount = pendingVoxelMeshQueue.length;
  const loadingCount =
    loadingTerrainCount + loadingVoxelCount + fetchQueueCount + meshQueueCount;
  const loadedCount = loadedVoxels.size;
  const loadedByLod: Partial<Record<1 | 2 | 4 | 8 | 16 | 32, number>> = {};
  const memoryByLod: Partial<Record<1 | 2 | 4 | 8 | 16 | 32, number>> = {};
  let terrainMemoryBytes = 0;
  let voxelMemoryBytes = 0;
  let loadedVoxelGeometryBytes = 0;
  let loadedVoxelMetadataBytes = 0;
  let cachedTerrainMemoryBytes = 0;
  let cachedVoxelMemoryBytes = 0;
  let cachedVoxelByLodBytes = 0;
  let queuedMemoryBytes = 0;

  for (const tile of loadedTerrain.values()) {
    const lod = tile.lod as 1 | 2 | 4 | 8 | 16 | 32;
    const tileBytes = estimateLoadedTerrainTileBytes(tile);
    terrainMemoryBytes += tileBytes;
    addMemoryToLod(memoryByLod, lod, tileBytes);
  }

  for (const cached of warmCachedTerrain.values()) {
    const lod = cached.tile.lod as 1 | 2 | 4 | 8 | 16 | 32;
    cachedTerrainMemoryBytes += cached.bytes;
    addMemoryToLod(memoryByLod, lod, cached.bytes);
  }

  for (const tile of loadedVoxels.values()) {
    const lod = tile.lod as 1 | 2 | 4 | 8 | 16 | 32;
    const tileMemory = estimateLoadedVoxelTileMemory(tile);
    loadedByLod[lod] = (loadedByLod[lod] ?? 0) + 1;
    loadedVoxelGeometryBytes += tileMemory.geometryBytes;
    loadedVoxelMetadataBytes += tileMemory.metadataBytes;
    voxelMemoryBytes += tileMemory.totalBytes;
    addMemoryToLod(memoryByLod, lod, tileMemory.totalBytes);
  }

  for (const cached of warmCachedVoxels.values()) {
    const lod = cached.tile.lod as 1 | 2 | 4 | 8 | 16 | 32;
    cachedVoxelMemoryBytes += cached.bytes;
    cachedVoxelByLodBytes += cached.bytes;
    addMemoryToLod(memoryByLod, lod, cached.bytes);
  }

  for (const item of pendingVoxelMeshQueue) {
    for (const quadrant of [
      ...item.quadrantMeshes,
      ...item.transparentQuadrantMeshes,
    ]) {
      queuedMemoryBytes += quadrant.positions.byteLength;
      queuedMemoryBytes += quadrant.normals.byteLength;
      queuedMemoryBytes += quadrant.baseColors.byteLength;
      queuedMemoryBytes += quadrant.faceAo.byteLength;
      queuedMemoryBytes += quadrant.trianglePaletteIndices.byteLength;
      queuedMemoryBytes += quadrant.indices.byteLength;
    }
    queuedMemoryBytes += item.chunkTopHeights.byteLength;
  }

  const memoryBytes =
    terrainMemoryBytes +
    voxelMemoryBytes +
    cachedTerrainMemoryBytes +
    cachedVoxelMemoryBytes +
    queuedMemoryBytes;
  const perfWithMemory = performance as Performance & {
    memory?: PerformanceMemoryInfo;
  };
  const jsHeapBytes = perfWithMemory.memory?.usedJSHeapSize ?? null;

  const statsPayload: ChunkStats = {
    loading: loadingCount,
    loaded: loadedCount,
    fps: fpsValue,
    focusLod: activeFocusLod,
    loadingBreakdown: {
      terrain: loadingTerrainCount,
      voxels: loadingVoxelCount,
      fetchQueue: fetchQueueCount,
      meshQueue: meshQueueCount,
    },
    voxelHealth: {
      missing: missingVoxels.size,
      failed: failedVoxels.size,
    },
    loadedByLod,
    memoryBytes,
    memoryBreakdown: {
      terrain: terrainMemoryBytes,
      voxels: voxelMemoryBytes,
      voxelGeometry: loadedVoxelGeometryBytes,
      voxelMetadata: loadedVoxelMetadataBytes,
      cachedTerrain: cachedTerrainMemoryBytes,
      cachedVoxels: cachedVoxelMemoryBytes,
      warmVoxels: cachedVoxelByLodBytes,
      queued: queuedMemoryBytes,
      queuedVoxelOutput: queuedMemoryBytes,
    },
    memoryByLod,
    jsHeapBytes,
    warmCacheCount: {
      terrain: warmCachedTerrain.size,
      voxels: warmCachedVoxels.size,
    },
    voxelBenchmark,
    blockLight: blockLightStats,
  };
  const statsKey = JSON.stringify(statsPayload);
  if (lastChunkStatsRef.current !== statsKey) {
    lastChunkStatsRef.current = statsKey;
    onChunkStatsChange(statsPayload);
  }
}
