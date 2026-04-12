import type { ChunkStats } from "../debug.js";

import {
  addMemoryToLod,
  estimateGeometryBytes,
  estimateLoadedVoxelTileBytes,
} from "./memory.js";
import type {
  LoadedTerrainTile,
  LoadedVoxelTile,
  PendingVoxelFetchRequest,
  PendingVoxelMeshItem,
  PerformanceMemoryInfo,
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
}

export function publishChunkStats(args: {
  mode: "terrain" | "voxel";
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
  warmCachedVoxels: Map<string, WarmCachedVoxelTile>;
  voxelBenchmark: RollingVoxelBenchmarkStats;
  lastChunkStatsRef: { current: string };
  onChunkStatsChange: (stats: ChunkStats) => void;
}): void {
  const {
    mode,
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
    warmCachedVoxels,
    voxelBenchmark,
    lastChunkStatsRef,
    onChunkStatsChange,
  } = args;

  const loadingTerrainCount = loadingTerrain.size;
  const loadingVoxelCount = loadingVoxels.size;
  const fetchQueueCount = pendingVoxelFetchQueue.length;
  const meshQueueCount = pendingVoxelMeshQueue.length;
  const loadingCount =
    loadingTerrainCount + loadingVoxelCount + fetchQueueCount + meshQueueCount;
  const loadedCount =
    mode === "terrain" ? loadedTerrain.size : loadedVoxels.size;
  const loadedByLod: Partial<Record<1 | 2 | 4 | 8 | 16 | 32, number>> = {};
  const memoryByLod: Partial<Record<1 | 2 | 4 | 8 | 16 | 32, number>> = {};
  let terrainMemoryBytes = 0;
  let voxelMemoryBytes = 0;
  let cachedVoxelMemoryBytes = 0;
  let queuedMemoryBytes = 0;

  for (const tile of loadedTerrain.values()) {
    const lod = tile.lod as 1 | 2 | 4 | 8 | 16 | 32;
    const tileBytes =
      estimateGeometryBytes(tile.mesh.geometry) +
      estimateGeometryBytes(tile.borderLines.geometry);
    if (mode === "terrain") {
      loadedByLod[lod] = (loadedByLod[lod] ?? 0) + 1;
    }
    terrainMemoryBytes += tileBytes;
    addMemoryToLod(memoryByLod, lod, tileBytes);
  }

  for (const tile of loadedVoxels.values()) {
    const lod = tile.lod as 1 | 2 | 4 | 8 | 16 | 32;
    const tileBytes = estimateLoadedVoxelTileBytes(tile);
    if (mode === "voxel") {
      loadedByLod[lod] = (loadedByLod[lod] ?? 0) + 1;
    }
    voxelMemoryBytes += tileBytes;
    addMemoryToLod(memoryByLod, lod, tileBytes);
  }

  for (const cached of warmCachedVoxels.values()) {
    const lod = cached.tile.lod as 1 | 2 | 4 | 8 | 16 | 32;
    cachedVoxelMemoryBytes += cached.bytes;
    addMemoryToLod(memoryByLod, lod, cached.bytes);
  }

  for (const item of pendingVoxelMeshQueue) {
    for (const quadrant of item.quadrantMeshes) {
      queuedMemoryBytes += quadrant.positions.byteLength;
      queuedMemoryBytes += quadrant.normals.byteLength;
      queuedMemoryBytes += quadrant.colors.byteLength;
      queuedMemoryBytes += quadrant.indices.byteLength;
    }
    queuedMemoryBytes += item.chunkTopHeights.byteLength;
  }

  const memoryBytes =
    terrainMemoryBytes +
    voxelMemoryBytes +
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
    mode,
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
      cached: cachedVoxelMemoryBytes,
      queued: queuedMemoryBytes,
    },
    memoryByLod,
    jsHeapBytes,
    warmCacheCount: warmCachedVoxels.size,
    voxelBenchmark,
  };
  const statsKey = JSON.stringify(statsPayload);
  if (lastChunkStatsRef.current !== statsKey) {
    lastChunkStatsRef.current = statsKey;
    onChunkStatsChange(statsPayload);
  }
}
