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
  WorkerMeshResult,
} from "./types.js";
import type { VoxelWorkScheduler } from "./voxel-work.js";

const OPTIONAL_BENCHMARK_METRICS = [
  ["avgTransferBytes", "transferBytes"],
  ["avgEncodedBodyBytes", "encodedBodyBytes"],
  ["avgDecodedBodyBytes", "decodedBodyBytes"],
  ["avgRawBufferBytes", "rawBufferBytes"],
  ["avgWorkerOutputBytes", "workerOutputBytes"],
  ["avgEmissiveBytes", "emissiveBytes"],
  ["avgEmissiveGridBuildMs", "emissiveGridBuildMs"],
  ["avgEmissiveBakeMs", "emissiveBakeMs"],
  ["avgEmissiveQuadsEvaluated", "emissiveQuadsEvaluated"],
  ["avgEmissiveQuadsCulled", "emissiveQuadsCulled"],
  ["avgEmissiveCandidateVisits", "emissiveCandidateVisits"],
  ["avgEmitterMetadataBytes", "emitterMetadataBytes"],
  ["avgEmitterPowerMin", "emitterPowerMin"],
  ["avgEmitterPowerMax", "emitterPowerMax"],
  ["avgEmitterRadiusMin", "emitterRadiusMin"],
  ["avgEmitterRadiusMax", "emitterRadiusMax"],
  ["avgServerRunMs", "serverRunMs"],
  ["avgServerHaloMs", "serverHaloMs"],
] as const;

type OptionalBenchmarkAverage = (typeof OPTIONAL_BENCHMARK_METRICS)[number][0];
type OptionalMetricAggregate = { sum: number; count: number };

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
  avgEmissiveCandidateVisits: number | null;
  avgEmitterMetadataBytes: number | null;
  avgEmitterPowerMin: number | null;
  avgEmitterPowerMax: number | null;
  avgEmitterRadiusMin: number | null;
  avgEmitterRadiusMax: number | null;
  avgServerRunMs: number | null;
  avgServerHaloMs: number | null;
  validSamples: {
    emissiveGridBuild: number;
    emissiveBake: number;
    serverRun: number;
    serverHalo: number;
  };
  optionalMetricAggregates: Record<
    OptionalBenchmarkAverage,
    OptionalMetricAggregate
  >;
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
  const optionalMetricAggregates = Object.fromEntries(
    OPTIONAL_BENCHMARK_METRICS.map(([average]) => [
      average,
      { sum: 0, count: 0 },
    ]),
  ) as Record<OptionalBenchmarkAverage, OptionalMetricAggregate>;
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
    avgEmissiveCandidateVisits: null,
    avgEmitterMetadataBytes: null,
    avgEmitterPowerMin: null,
    avgEmitterPowerMax: null,
    avgEmitterRadiusMin: null,
    avgEmitterRadiusMax: null,
    avgServerRunMs: null,
    avgServerHaloMs: null,
    validSamples: {
      emissiveGridBuild: 0,
      emissiveBake: 0,
      serverRun: 0,
      serverHalo: 0,
    },
    optionalMetricAggregates,
    cacheHitSamples: 0,
    cacheMissSamples: 0,
    cacheUnknownSamples: 0,
    haloEmittersEnabled,
    emissiveAttributesEnabled,
  };
}

export function addVoxelBenchmarkSample(
  current: RollingVoxelBenchmarkStats,
  sample: NonNullable<WorkerMeshResult["benchmark"]>,
): RollingVoxelBenchmarkStats {
  const nextSamples = current.samples + 1;
  const aggregates = { ...current.optionalMetricAggregates };
  const averages = {} as Record<OptionalBenchmarkAverage, number | null>;
  for (const [averageKey, sampleKey] of OPTIONAL_BENCHMARK_METRICS) {
    const previous = current.optionalMetricAggregates[averageKey];
    const value = sample[sampleKey];
    const next =
      value === null
        ? previous
        : { sum: previous.sum + value, count: previous.count + 1 };
    aggregates[averageKey] = next;
    averages[averageKey] = next.count === 0 ? null : next.sum / next.count;
  }
  const cacheOutcome = sample.cacheOutcome ?? "unknown";
  return {
    ...current,
    samples: nextSamples,
    contentEncoding: sample.contentEncoding,
    avgFetchMs:
      (current.avgFetchMs * current.samples + sample.fetchMs) / nextSamples,
    avgDecodeMs:
      (current.avgDecodeMs * current.samples + sample.decodeMs) / nextSamples,
    avgTotalMs:
      (current.avgTotalMs * current.samples + sample.totalMs) / nextSamples,
    ...averages,
    validSamples: {
      emissiveGridBuild: aggregates.avgEmissiveGridBuildMs.count,
      emissiveBake: aggregates.avgEmissiveBakeMs.count,
      serverRun: aggregates.avgServerRunMs.count,
      serverHalo: aggregates.avgServerHaloMs.count,
    },
    optionalMetricAggregates: aggregates,
    cacheHitSamples: current.cacheHitSamples + (cacheOutcome === "hit" ? 1 : 0),
    cacheMissSamples:
      current.cacheMissSamples + (cacheOutcome === "miss" ? 1 : 0),
    cacheUnknownSamples:
      current.cacheUnknownSamples + (cacheOutcome === "unknown" ? 1 : 0),
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
  voxelPipeline: {
    snapshot: ReturnType<VoxelWorkScheduler["snapshot"]>;
    diagnostics: VoxelWorkScheduler["diagnostics"];
  };
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
    voxelPipeline,
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
      queuedMemoryBytes += quadrant.emissiveColors?.byteLength ?? 0;
      queuedMemoryBytes += quadrant.faceAo.byteLength;
      queuedMemoryBytes += quadrant.trianglePaletteIndices.byteLength;
      queuedMemoryBytes += quadrant.indices.byteLength;
    }
    queuedMemoryBytes += item.chunkTopHeights.byteLength;
    queuedMemoryBytes += item.emitterRecords.length * 32;
  }

  const memoryBytes =
    terrainMemoryBytes +
    voxelMemoryBytes +
    cachedTerrainMemoryBytes +
    cachedVoxelMemoryBytes +
    queuedMemoryBytes +
    voxelPipeline.snapshot.compactInput.bytes +
    blockLightStats.poolMemoryBytes;
  const perfWithMemory = performance as Performance & {
    memory?: PerformanceMemoryInfo;
  };
  const jsHeapBytes = perfWithMemory.memory?.usedJSHeapSize ?? null;

  const { optionalMetricAggregates: _, ...publishedVoxelBenchmark } =
    voxelBenchmark;
  const averageTiming = (
    key: keyof typeof voxelPipeline.diagnostics.timings,
  ) => {
    const aggregate = voxelPipeline.diagnostics.timings[key];
    return {
      averageMs:
        aggregate.samples === 0 ? null : aggregate.sumMs / aggregate.samples,
      samples: aggregate.samples,
    };
  };
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
      queued: queuedMemoryBytes + voxelPipeline.snapshot.compactInput.bytes,
      queuedVoxelOutput: queuedMemoryBytes,
      blockLightPool: blockLightStats.poolMemoryBytes,
    },
    memoryByLod,
    jsHeapBytes,
    warmCacheCount: {
      terrain: warmCachedTerrain.size,
      voxels: warmCachedVoxels.size,
    },
    voxelPipeline: {
      compactInput: voxelPipeline.snapshot.compactInput,
      expandedOutput: voxelPipeline.snapshot.expandedOutput,
      timings: {
        fetchMs: averageTiming("fetchMs"),
        compactQueueWaitMs: averageTiming("compactQueueWaitMs"),
        workerExecutionMs: averageTiming("workerExecutionMs"),
        resultTransferWaitMs: averageTiming("resultTransferWaitMs"),
        sceneQueueWaitMs: averageTiming("sceneQueueWaitMs"),
        requestToVisibleMs: averageTiming("requestToVisibleMs"),
      },
      cancellations: { ...voxelPipeline.diagnostics.cancellations },
      discards: { ...voxelPipeline.diagnostics.discards },
    },
    voxelBenchmark: publishedVoxelBenchmark,
    blockLight: blockLightStats,
  };
  const statsKey = JSON.stringify(statsPayload);
  if (lastChunkStatsRef.current !== statsKey) {
    lastChunkStatsRef.current = statsKey;
    onChunkStatsChange(statsPayload);
  }
}
