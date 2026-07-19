export type LoadingBreakdown = {
  terrain: number;
  voxels: number;
  fetchQueue: number;
  meshQueue: number;
};

export function createEmptyLoadingBreakdown(): LoadingBreakdown {
  return {
    terrain: 0,
    voxels: 0,
    fetchQueue: 0,
    meshQueue: 0,
  };
}

export type ChunkStats = {
  loading: number;
  loaded: number;
  fps: number;
  focusLod: number;
  loadingBreakdown: LoadingBreakdown;
  voxelHealth: {
    missing: number;
    failed: number;
  };
  loadedByLod: Partial<Record<1 | 2 | 4 | 8 | 16 | 32, number>>;
  memoryBytes: number;
  memoryBreakdown: {
    terrain: number;
    voxels: number;
    voxelGeometry: number;
    voxelMetadata: number;
    cachedTerrain: number;
    cachedVoxels: number;
    warmVoxels: number;
    queued: number;
    queuedVoxelOutput: number;
    blockLightPool: number;
  };
  memoryByLod: Partial<Record<1 | 2 | 4 | 8 | 16 | 32, number>>;
  jsHeapBytes: number | null;
  warmCacheCount: {
    terrain: number;
    voxels: number;
  };
  voxelPipeline: {
    loadGeneration: number;
    compactInput: { jobs: number; bytes: number };
    retainedEnhancementInput: { jobs: number; bytes: number };
    retainedEnhancementCapacity: { jobs: number; bytes: number };
    reservedExpandedOutput: { jobs: number; bytes: number };
    expandedOutput: { jobs: number; bytes: number };
    expandedOutputCapacity: { jobs: number; bytes: number };
    adaptive: {
      profile: string;
      limiterReason: string;
      diagnostics: {
        initialTarget: number;
        maximumTarget: number;
        scaleUpTransitions: number;
        scaleDownTransitions: number;
        limiterObservations: Record<string, number>;
        peakExecutableBaseJobs: number;
        peakOldestExecutableBaseAgeMs: number;
        firstTransitionAt: number | null;
        latestTransitionAt: number | null;
      };
    };
    timings: Record<
      | "fetchMs"
      | "selectionToFetchStartMs"
      | "compactQueueWaitMs"
      | "baseWorkerExecutionMs"
      | "resultTransferWaitMs"
      | "sceneQueueWaitMs"
      | "selectionToBaseVisibleMs"
      | "enhancementQueueWaitMs"
      | "enhancementWorkerExecutionMs"
      | "enhancementResultTransferWaitMs"
      | "enhancementAttachWaitMs"
      | "selectionToEnhancedMs",
      {
        count: number;
        p50Ms: number | null;
        p95Ms: number | null;
        maxMs: number | null;
      }
    >;
    currentQueue: {
      jobs: number;
      executableStages: Record<string, { jobs: number; bytes: number }>;
      nonExecutableDemand: Record<string, number>;
      oldestDemandAgeMs: {
        overall: number | null;
        byLod: Record<string, number>;
        bySafetyClass: Record<string, number>;
        byCoverageClass: Record<string, number>;
        byViewClass: Record<string, number>;
        byPhase: Record<string, number>;
      };
    };
    focusDeadlineMisses: number;
    sceneBacklog: { jobs: number; bytes: number };
    observations: Record<
      | "frameTimeMs"
      | "workerBusyRatio"
      | "workerDurationMs"
      | "reservedExpandedBytes"
      | "activeWorkers"
      | "targetWorkers",
      {
        count: number;
        p50: number | null;
        p95: number | null;
        max: number | null;
      }
    >;
    cancellations: Record<string, number>;
    discards: Record<string, number>;
  };
  voxelBenchmark: {
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
    avgBaseWorkerOutputBytes: number | null;
    avgEnhancementWorkerOutputBytes: number | null;
    avgCombinedWorkerOutputBytes: number | null;
    avgEmissiveBytes: number | null;
    avgEmissiveGridBuildMs: number | null;
    avgEmissiveBakeMs: number | null;
    avgEmissiveQuadsEvaluated: number | null;
    avgEmissiveQuadsCulled: number | null;
    avgEmissiveReceiverEvaluations: number | null;
    avgEmissiveNeighborhoodCellProbes: number | null;
    avgEmissiveNonEmptyBuckets: number | null;
    avgEmissiveRawBucketEntries: number | null;
    avgEmissiveDeduplicatedNeighborhoodEntries: number | null;
    avgEmissiveCandidateVisits: number | null;
    avgEmissiveCacheHits: number | null;
    avgEmissiveCacheMisses: number | null;
    avgEmissiveCacheEntries: number | null;
    avgEmissiveUncachedFallbacks: number | null;
    avgEmissivePeakAccountedCacheBytes: number | null;
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
    cacheHitSamples: number;
    cacheMissSamples: number;
    cacheUnknownSamples: number;
    emissiveSkippedSamples: number;
    haloEmittersEnabled: boolean;
    emissiveAttributesEnabled: boolean;
  };
  blockLight: {
    decodedEmitters: number;
    activeEmitters: number;
    budget: number;
    glowBudget: number;
    pointLightBudget: number;
    glowPoolAllocated: number;
    glowPoolUsed: number;
    pointLightPoolAllocated: number;
    poolMemoryBytes: number;
    runtimeMs: number;
    degraded: boolean;
  };
};

export interface MapDebugSettings {
  atmosphereTimeOfDay: number;
  atmosphereQuality: number;
  blockLightQuality: number;
  frameRateCapFps: number;
  idleFrameRateCapFps: number;
  lodUnloadHysteresis: number;
  maxConcurrentVoxelFetches: number;
  voxelCompactInputMaxJobs: number;
  voxelCompactInputMaxBytes: number;
  voxelRetainedEnhancementMaxJobs: number;
  voxelRetainedEnhancementMaxBytes: number;
  voxelExpandedOutputMaxJobs: number;
  voxelExpandedOutputMaxBytes: number;
  voxelWorkerTarget: number;
  voxelCancellationCheckpointMs: number;
  maxConcurrentTerrainFetches: number;
  voxelTopAoIntensity: number;
  voxelWallAoIntensity: number;
  voxelFocusStickyMs: number;
  voxelFocusSmoothAlpha: number;
  voxelLodHysteresisRatio: number;
  voxelBehindCameraDotStart: number;
  lodReferenceFov: number;
  lodReferenceViewportHeight: number;
  terrainLodHysteresisRatio: number;
  terrainMeshBuildBudgetMs: number;
  maxTerrainMeshesPerFrame: number;
  voxelBehindCameraMaxMultiplier: number;
  voxelViewEnterMarginDegrees: number;
  voxelViewExitMarginDegrees: number;
  voxelDetailRequestDebounceMs: number;
  voxelUnloadGraceMs: number;
  voxelMeshBuildBudgetMs: number;
  maxVoxelMeshesPerFrame: number;
  warmTerrainCacheMaxBytes: number;
  warmVoxelCacheLimitBytes: number;
  voxelHaloEmittersEnabled: number;
  voxelEmissiveAttributesEnabled: number;
  voxelProgressiveMeshingEnabled: number;
}

export interface MapDebugParameterDefinition {
  key: keyof MapDebugSettings;
  section:
    | "Atmosphere"
    | "Loading"
    | "LOD"
    | "Focus"
    | "Memory"
    | "Diagnostics";
  label: string;
  description: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  decimals?: number;
  toDisplay?: (value: number) => number;
  fromDisplay?: (value: number) => number;
  formatDisplay?: (value: number) => string;
}

const MB = 1024 * 1024;

export const DEFAULT_MAP_DEBUG_SETTINGS: MapDebugSettings = {
  atmosphereTimeOfDay: 12,
  atmosphereQuality: 1,
  blockLightQuality: 1,
  frameRateCapFps: 60,
  idleFrameRateCapFps: 15,
  maxConcurrentTerrainFetches: 4,
  terrainMeshBuildBudgetMs: 4,
  maxTerrainMeshesPerFrame: 2,
  maxConcurrentVoxelFetches: 8,
  voxelCompactInputMaxJobs: 8,
  voxelCompactInputMaxBytes: 32 * MB,
  voxelRetainedEnhancementMaxJobs: 16,
  voxelRetainedEnhancementMaxBytes: 128 * MB,
  voxelExpandedOutputMaxJobs: 4,
  voxelExpandedOutputMaxBytes: 256 * MB,
  voxelWorkerTarget: 0,
  voxelCancellationCheckpointMs: 4,
  voxelTopAoIntensity: 1,
  voxelWallAoIntensity: 0.5,
  terrainLodHysteresisRatio: 0.12,
  voxelDetailRequestDebounceMs: 180,
  voxelUnloadGraceMs: 750,
  voxelMeshBuildBudgetMs: 5,
  maxVoxelMeshesPerFrame: 8,
  lodUnloadHysteresis: 1.5,
  voxelBehindCameraDotStart: -0.5,
  voxelBehindCameraMaxMultiplier: 1.05,
  voxelViewEnterMarginDegrees: 12,
  voxelViewExitMarginDegrees: 18,
  lodReferenceFov: 60,
  lodReferenceViewportHeight: 2880,
  warmTerrainCacheMaxBytes: 256 * MB,
  warmVoxelCacheLimitBytes: 512 * MB,
  voxelFocusStickyMs: 1500,
  voxelFocusSmoothAlpha: 0.6,
  voxelLodHysteresisRatio: 0.12,
  voxelHaloEmittersEnabled: 1,
  voxelEmissiveAttributesEnabled: 1,
  voxelProgressiveMeshingEnabled: 1,
};

export function createEmptyChunkStats(): ChunkStats {
  return {
    loading: 0,
    loaded: 0,
    fps: 0,
    focusLod: 1,
    loadingBreakdown: createEmptyLoadingBreakdown(),
    voxelHealth: {
      missing: 0,
      failed: 0,
    },
    loadedByLod: {},
    memoryBytes: 0,
    memoryBreakdown: {
      terrain: 0,
      voxels: 0,
      voxelGeometry: 0,
      voxelMetadata: 0,
      cachedTerrain: 0,
      cachedVoxels: 0,
      warmVoxels: 0,
      queued: 0,
      queuedVoxelOutput: 0,
      blockLightPool: 0,
    },
    memoryByLod: {},
    jsHeapBytes: null,
    warmCacheCount: {
      terrain: 0,
      voxels: 0,
    },
    voxelPipeline: {
      loadGeneration: 1,
      compactInput: { jobs: 0, bytes: 0 },
      retainedEnhancementInput: { jobs: 0, bytes: 0 },
      retainedEnhancementCapacity: { jobs: 0, bytes: 0 },
      reservedExpandedOutput: { jobs: 0, bytes: 0 },
      expandedOutput: { jobs: 0, bytes: 0 },
      expandedOutputCapacity: { jobs: 0, bytes: 0 },
      adaptive: {
        profile: "fallback",
        limiterReason: "insufficient-demand",
        diagnostics: {
          initialTarget: 1,
          maximumTarget: 1,
          scaleUpTransitions: 0,
          scaleDownTransitions: 0,
          limiterObservations: {},
          peakExecutableBaseJobs: 0,
          peakOldestExecutableBaseAgeMs: 0,
          firstTransitionAt: null,
          latestTransitionAt: null,
        },
      },
      timings: {
        selectionToFetchStartMs: {
          count: 0,
          p50Ms: null,
          p95Ms: null,
          maxMs: null,
        },
        fetchMs: { count: 0, p50Ms: null, p95Ms: null, maxMs: null },
        compactQueueWaitMs: {
          count: 0,
          p50Ms: null,
          p95Ms: null,
          maxMs: null,
        },
        baseWorkerExecutionMs: {
          count: 0,
          p50Ms: null,
          p95Ms: null,
          maxMs: null,
        },
        resultTransferWaitMs: {
          count: 0,
          p50Ms: null,
          p95Ms: null,
          maxMs: null,
        },
        sceneQueueWaitMs: {
          count: 0,
          p50Ms: null,
          p95Ms: null,
          maxMs: null,
        },
        selectionToBaseVisibleMs: {
          count: 0,
          p50Ms: null,
          p95Ms: null,
          maxMs: null,
        },
        enhancementQueueWaitMs: {
          count: 0,
          p50Ms: null,
          p95Ms: null,
          maxMs: null,
        },
        enhancementWorkerExecutionMs: {
          count: 0,
          p50Ms: null,
          p95Ms: null,
          maxMs: null,
        },
        enhancementResultTransferWaitMs: {
          count: 0,
          p50Ms: null,
          p95Ms: null,
          maxMs: null,
        },
        enhancementAttachWaitMs: {
          count: 0,
          p50Ms: null,
          p95Ms: null,
          maxMs: null,
        },
        selectionToEnhancedMs: {
          count: 0,
          p50Ms: null,
          p95Ms: null,
          maxMs: null,
        },
      },
      currentQueue: {
        jobs: 0,
        executableStages: {},
        nonExecutableDemand: {},
        oldestDemandAgeMs: {
          overall: null,
          byLod: {},
          bySafetyClass: {},
          byCoverageClass: {},
          byViewClass: {},
          byPhase: {},
        },
      },
      focusDeadlineMisses: 0,
      sceneBacklog: { jobs: 0, bytes: 0 },
      observations: Object.fromEntries(
        [
          "frameTimeMs",
          "workerBusyRatio",
          "workerDurationMs",
          "reservedExpandedBytes",
          "activeWorkers",
          "targetWorkers",
        ].map((key) => [key, { count: 0, p50: null, p95: null, max: null }]),
      ) as ChunkStats["voxelPipeline"]["observations"],
      cancellations: {},
      discards: {},
    },
    voxelBenchmark: {
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
      avgBaseWorkerOutputBytes: null,
      avgEnhancementWorkerOutputBytes: null,
      avgCombinedWorkerOutputBytes: null,
      avgEmissiveBytes: null,
      avgEmissiveGridBuildMs: null,
      avgEmissiveBakeMs: null,
      avgEmissiveQuadsEvaluated: null,
      avgEmissiveQuadsCulled: null,
      avgEmissiveReceiverEvaluations: null,
      avgEmissiveNeighborhoodCellProbes: null,
      avgEmissiveNonEmptyBuckets: null,
      avgEmissiveRawBucketEntries: null,
      avgEmissiveDeduplicatedNeighborhoodEntries: null,
      avgEmissiveCandidateVisits: null,
      avgEmissiveCacheHits: null,
      avgEmissiveCacheMisses: null,
      avgEmissiveCacheEntries: null,
      avgEmissiveUncachedFallbacks: null,
      avgEmissivePeakAccountedCacheBytes: null,
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
      cacheHitSamples: 0,
      cacheMissSamples: 0,
      cacheUnknownSamples: 0,
      emissiveSkippedSamples: 0,
      haloEmittersEnabled: true,
      emissiveAttributesEnabled: true,
    },
    blockLight: {
      decodedEmitters: 0,
      activeEmitters: 0,
      budget: 0,
      glowBudget: 0,
      pointLightBudget: 0,
      glowPoolAllocated: 0,
      glowPoolUsed: 0,
      pointLightPoolAllocated: 0,
      poolMemoryBytes: 0,
      runtimeMs: 0,
      degraded: false,
    },
  };
}

export const MAP_DEBUG_PARAMETER_DEFINITIONS: MapDebugParameterDefinition[] = [
  {
    key: "atmosphereTimeOfDay",
    section: "Atmosphere",
    label: "Time Of Day",
    description:
      "Viewer-local atmosphere time. It changes sky color and lighting only; server data, world time, and voxel payloads are unchanged.",
    min: 0,
    max: 24,
    step: 0.25,
    defaultValue: DEFAULT_MAP_DEBUG_SETTINGS.atmosphereTimeOfDay,
    decimals: 2,
    formatDisplay: (value) => `${value.toFixed(2)}h`,
  },
  {
    key: "atmosphereQuality",
    section: "Atmosphere",
    label: "Atmosphere Quality",
    description:
      "Scales stylized sky, time-of-day lighting, and fog-like depth enhancement. 0 restores the fixed-lighting fallback.",
    min: 0,
    max: 2,
    step: 1,
    defaultValue: DEFAULT_MAP_DEBUG_SETTINGS.atmosphereQuality,
    formatDisplay: (value) =>
      value <= 0 ? "Off" : value >= 2 ? "High" : "Balanced",
  },
  {
    key: "blockLightQuality",
    section: "Atmosphere",
    label: "Block Lights",
    description:
      "Controls decoded Cubyz .emittedLight presentation. 0 disables mesh-local emitted light, glow sprites, and point lights; Balanced keeps subtle colored sprite accents over mesh lighting, while High adds a small point-light sparkle budget.",
    min: 0,
    max: 2,
    step: 1,
    defaultValue: DEFAULT_MAP_DEBUG_SETTINGS.blockLightQuality,
    formatDisplay: (value) =>
      value <= 0 ? "Off" : value >= 2 ? "High" : "Balanced",
  },
  {
    key: "maxConcurrentTerrainFetches",
    section: "Loading",
    label: "Concurrent Terrain Fetches",
    description:
      "Limits how many terrain tile requests can be in flight at the same time. Lower values reduce zoom spikes from simultaneous JSON and mesh work.",
    min: 1,
    max: 16,
    step: 1,
    defaultValue: DEFAULT_MAP_DEBUG_SETTINGS.maxConcurrentTerrainFetches,
  },
  {
    key: "terrainMeshBuildBudgetMs",
    section: "Loading",
    label: "Terrain Build Budget",
    description:
      "Per-frame time budget for turning fetched terrain payloads into Three.js meshes. Lower values improve frame pacing at the cost of slower refinement.",
    min: 1,
    max: 20,
    step: 1,
    defaultValue: DEFAULT_MAP_DEBUG_SETTINGS.terrainMeshBuildBudgetMs,
    formatDisplay: (value) => `${Math.round(value)} ms`,
  },
  {
    key: "maxTerrainMeshesPerFrame",
    section: "Loading",
    label: "Terrain Meshes Per Frame",
    description:
      "Caps how many queued terrain meshes may be built in a single frame. Lower values avoid large zoom-time stalls.",
    min: 1,
    max: 12,
    step: 1,
    defaultValue: DEFAULT_MAP_DEBUG_SETTINGS.maxTerrainMeshesPerFrame,
  },
  {
    key: "maxConcurrentVoxelFetches",
    section: "Loading",
    label: "Concurrent Voxel Fetches",
    description:
      "Limits how many voxel region HTTP requests can be in flight at the same time. Higher values can improve throughput but may compete harder for bandwidth.",
    min: 1,
    max: 32,
    step: 1,
    defaultValue: DEFAULT_MAP_DEBUG_SETTINGS.maxConcurrentVoxelFetches,
  },
  {
    key: "voxelCompactInputMaxJobs",
    section: "Loading",
    label: "Compact Input Jobs",
    description:
      "Maximum fetched voxel payloads retained while waiting for worker dispatch.",
    min: 1,
    max: 64,
    step: 1,
    defaultValue: DEFAULT_MAP_DEBUG_SETTINGS.voxelCompactInputMaxJobs,
  },
  {
    key: "voxelCompactInputMaxBytes",
    section: "Loading",
    label: "Compact Input Memory",
    description:
      "Byte budget for fetched voxel payloads retained before worker dispatch.",
    min: MB,
    max: 512 * MB,
    step: MB,
    defaultValue: DEFAULT_MAP_DEBUG_SETTINGS.voxelCompactInputMaxBytes,
    toDisplay: (value) => value / MB,
    fromDisplay: (value) => value * MB,
    formatDisplay: (value) => `${Math.round(value)} MiB`,
  },
  {
    key: "voxelRetainedEnhancementMaxJobs",
    section: "Loading",
    label: "Retained Enhancement Jobs",
    description:
      "Bounds progressive emissive inputs retained after base geometry is visible.",
    min: 1,
    max: 64,
    step: 1,
    defaultValue: DEFAULT_MAP_DEBUG_SETTINGS.voxelRetainedEnhancementMaxJobs,
  },
  {
    key: "voxelRetainedEnhancementMaxBytes",
    section: "Loading",
    label: "Retained Enhancement Memory",
    description:
      "Separate byte budget for progressive emissive inputs; it does not block base fetch admission.",
    min: MB,
    max: 512 * MB,
    step: MB,
    defaultValue: DEFAULT_MAP_DEBUG_SETTINGS.voxelRetainedEnhancementMaxBytes,
    toDisplay: (value) => value / MB,
    fromDisplay: (value) => value * MB,
    formatDisplay: (value) => `${Math.round(value)} MiB`,
  },
  {
    key: "voxelExpandedOutputMaxJobs",
    section: "Loading",
    label: "Expanded Output Jobs",
    description:
      "Maximum worker mesh results retained while waiting for scene insertion.",
    min: 1,
    max: 32,
    step: 1,
    defaultValue: DEFAULT_MAP_DEBUG_SETTINGS.voxelExpandedOutputMaxJobs,
  },
  {
    key: "voxelExpandedOutputMaxBytes",
    section: "Loading",
    label: "Expanded Output Memory",
    description:
      "Byte budget for expanded worker mesh arrays waiting for scene insertion.",
    min: MB,
    max: 1024 * MB,
    step: MB,
    defaultValue: DEFAULT_MAP_DEBUG_SETTINGS.voxelExpandedOutputMaxBytes,
    toDisplay: (value) => value / MB,
    fromDisplay: (value) => value * MB,
    formatDisplay: (value) => `${Math.round(value)} MiB`,
  },
  {
    key: "voxelWorkerTarget",
    section: "Loading",
    label: "Voxel Worker Target",
    description:
      "Uses adaptive profile-based concurrency at 0, or a fixed worker count from 1 through 4.",
    min: 0,
    max: 4,
    step: 1,
    defaultValue: DEFAULT_MAP_DEBUG_SETTINGS.voxelWorkerTarget,
    formatDisplay: (value) =>
      value === 0 ? "Adaptive" : `${Math.round(value)} fixed`,
  },
  {
    key: "voxelCancellationCheckpointMs",
    section: "Loading",
    label: "Cancellation Checkpoint",
    description:
      "Worker time budget between cooperative yields that can observe cancellation.",
    min: 1,
    max: 20,
    step: 1,
    defaultValue: DEFAULT_MAP_DEBUG_SETTINGS.voxelCancellationCheckpointMs,
    formatDisplay: (value) => `${Math.round(value)} ms`,
  },
  {
    key: "voxelDetailRequestDebounceMs",
    section: "Loading",
    label: "Detail Debounce",
    description:
      "Delay before the client starts committing detail voxel requests after camera motion. Higher values avoid waste during movement, lower values refine faster.",
    min: 0,
    max: 1000,
    step: 10,
    defaultValue: DEFAULT_MAP_DEBUG_SETTINGS.voxelDetailRequestDebounceMs,
    formatDisplay: (value) => `${Math.round(value)} ms`,
  },
  {
    key: "voxelUnloadGraceMs",
    section: "Loading",
    label: "Unload Grace",
    description:
      "How long a voxel tile stays eligible to remain loaded after it stops being requested. Higher values reduce pop when turning around quickly.",
    min: 0,
    max: 5000,
    step: 50,
    defaultValue: DEFAULT_MAP_DEBUG_SETTINGS.voxelUnloadGraceMs,
    formatDisplay: (value) => `${Math.round(value)} ms`,
  },
  {
    key: "voxelMeshBuildBudgetMs",
    section: "Loading",
    label: "Mesh Build Budget",
    description:
      "Per-frame time budget for turning worker results into Three.js meshes. Higher values upload more data each frame but can hurt frame pacing.",
    min: 1,
    max: 20,
    step: 1,
    defaultValue: DEFAULT_MAP_DEBUG_SETTINGS.voxelMeshBuildBudgetMs,
    formatDisplay: (value) => `${Math.round(value)} ms`,
  },
  {
    key: "maxVoxelMeshesPerFrame",
    section: "Loading",
    label: "Meshes Per Frame",
    description:
      "Caps how many queued voxel meshes may be built in a single frame. Higher values empty the queue faster but can spike frame time.",
    min: 1,
    max: 32,
    step: 1,
    defaultValue: DEFAULT_MAP_DEBUG_SETTINGS.maxVoxelMeshesPerFrame,
  },
  {
    key: "terrainLodHysteresisRatio",
    section: "LOD",
    label: "Terrain LOD Hysteresis",
    description:
      "How much terrain LOD transitions resist small distance changes. Higher values reduce zoom churn before terrain tiles are replaced.",
    min: 0,
    max: 0.5,
    step: 0.01,
    defaultValue: DEFAULT_MAP_DEBUG_SETTINGS.terrainLodHysteresisRatio,
    decimals: 2,
  },
  {
    key: "lodUnloadHysteresis",
    section: "LOD",
    label: "LOD Unload Hysteresis",
    description:
      "Controls how much farther a chunk can drift before it is unloaded. Higher values reduce unload/reload churn but keep more data in memory.",
    min: 1,
    max: 3,
    step: 0.05,
    defaultValue: DEFAULT_MAP_DEBUG_SETTINGS.lodUnloadHysteresis,
    decimals: 2,
  },
  {
    key: "voxelLodHysteresisRatio",
    section: "LOD",
    label: "LOD Hysteresis Ratio",
    description:
      "How much LOD transitions resist small distance changes. Higher values reduce rapid LOD flipping but make transitions more conservative.",
    min: 0,
    max: 0.5,
    step: 0.01,
    defaultValue: DEFAULT_MAP_DEBUG_SETTINGS.voxelLodHysteresisRatio,
    decimals: 2,
  },
  {
    key: "voxelBehindCameraDotStart",
    section: "LOD",
    label: "Behind-Camera Start",
    description:
      "Horizontal dot-product threshold where behind-camera bias starts for voxel focus and per-region LOD selection. Values near -0.25 usually affect chunks clearly behind you without spilling too far into the front hemisphere.",
    min: -1,
    max: 0.5,
    step: 0.01,
    defaultValue: DEFAULT_MAP_DEBUG_SETTINGS.voxelBehindCameraDotStart,
    decimals: 2,
  },
  {
    key: "voxelBehindCameraMaxMultiplier",
    section: "LOD",
    label: "Behind-Camera Multiplier",
    description:
      "Maximum distance multiplier applied to behind-camera voxel focus candidates and voxel regions during LOD selection. With the current size-aware rear bias, useful values usually stay in the 1.05 to 1.15 range.",
    min: 1,
    max: 1.15,
    step: 0.05,
    defaultValue: DEFAULT_MAP_DEBUG_SETTINGS.voxelBehindCameraMaxMultiplier,
    decimals: 2,
  },
  {
    key: "voxelViewEnterMarginDegrees",
    section: "LOD",
    label: "View Detail Enter Margin",
    description:
      "Angular margin outside the camera frustum where tiles may enter forward detail. Larger values refine more edge-adjacent geometry.",
    min: 0,
    max: 45,
    step: 1,
    defaultValue: DEFAULT_MAP_DEBUG_SETTINGS.voxelViewEnterMarginDegrees,
    formatDisplay: (value) => `${Math.round(value)}°`,
  },
  {
    key: "voxelViewExitMarginDegrees",
    section: "LOD",
    label: "View Detail Exit Margin",
    description:
      "Retained angular margin for the previous view class. Keep this at or above the enter margin to prevent refinement churn during rotation.",
    min: 0,
    max: 60,
    step: 1,
    defaultValue: DEFAULT_MAP_DEBUG_SETTINGS.voxelViewExitMarginDegrees,
    formatDisplay: (value) => `${Math.round(value)}°`,
  },
  {
    key: "lodReferenceFov",
    section: "LOD",
    label: "LOD Baseline FOV",
    description:
      "Baseline camera vertical FOV, in degrees, used for voxel LOD scaling. Higher values select finer LOD at the same active camera FOV.",
    min: 20,
    max: 120,
    step: 1,
    defaultValue: DEFAULT_MAP_DEBUG_SETTINGS.lodReferenceFov,
    formatDisplay: (value) => `${Math.round(value)}°`,
  },
  {
    key: "lodReferenceViewportHeight",
    section: "LOD",
    label: "LOD Baseline Viewport Height",
    description:
      "Baseline viewport height, in pixels, used for voxel LOD scaling. Lower values select finer LOD; higher values select coarser LOD at the same active viewport height.",
    min: 360,
    max: 4320,
    step: 60,
    defaultValue: DEFAULT_MAP_DEBUG_SETTINGS.lodReferenceViewportHeight,
    formatDisplay: (value) => `${Math.round(value)} px`,
  },
  {
    key: "voxelFocusStickyMs",
    section: "Focus",
    label: "Focus Sticky Time",
    description:
      "How long the last voxel ray hit remains the preferred focus point after you stop hitting geometry. Higher values reduce focus jitter but can lag behind sudden camera turns.",
    min: 0,
    max: 4000,
    step: 50,
    defaultValue: DEFAULT_MAP_DEBUG_SETTINGS.voxelFocusStickyMs,
    formatDisplay: (value) => `${Math.round(value)} ms`,
  },
  {
    key: "voxelFocusSmoothAlpha",
    section: "Focus",
    label: "Focus Smooth Alpha",
    description:
      "Blend factor for smoothing the voxel focus point and distance. Higher values react faster, lower values feel steadier.",
    min: 0,
    max: 1,
    step: 0.01,
    defaultValue: DEFAULT_MAP_DEBUG_SETTINGS.voxelFocusSmoothAlpha,
    decimals: 2,
  },
  {
    key: "warmTerrainCacheMaxBytes",
    section: "Memory",
    label: "Terrain Warm Cache Limit",
    description:
      "Maximum memory reserved for keeping recently unloaded terrain tiles ready for quick reuse. Higher values improve nearby pan reuse at the cost of memory.",
    min: 0,
    max: 2048,
    step: 32,
    defaultValue: DEFAULT_MAP_DEBUG_SETTINGS.warmTerrainCacheMaxBytes,
    toDisplay: (value) => value / MB,
    fromDisplay: (value) => Math.round(value * MB),
    formatDisplay: (value) => `${Math.round(value)} MB`,
  },
  {
    key: "warmVoxelCacheLimitBytes",
    section: "Memory",
    label: "Voxel Warm Cache Limit",
    description:
      "Maximum memory reserved for keeping recently unloaded voxel tiles ready for quick reuse. Higher values improve turn-around reuse at the cost of memory.",
    min: 0,
    max: 2048,
    step: 32,
    defaultValue: DEFAULT_MAP_DEBUG_SETTINGS.warmVoxelCacheLimitBytes,
    toDisplay: (value) => value / MB,
    fromDisplay: (value) => Math.round(value * MB),
    formatDisplay: (value) => `${Math.round(value)} MB`,
  },
  {
    key: "voxelHaloEmittersEnabled",
    section: "Diagnostics",
    label: "Diag: Halo Emitters",
    description:
      "Temporary voxel-lighting diagnostic. 0 requests LOD 1 voxel payloads without neighboring-region halo emitter records so server halo cost can be isolated. Diagnostic payloads are cached separately and never reused as normal payloads. Default 1 keeps normal behavior.",
    min: 0,
    max: 1,
    step: 1,
    defaultValue: DEFAULT_MAP_DEBUG_SETTINGS.voxelHaloEmittersEnabled,
    formatDisplay: (value) => (value <= 0 ? "Off" : "On"),
  },
  {
    key: "voxelProgressiveMeshingEnabled",
    section: "Diagnostics",
    label: "Progressive Voxel Meshing",
    description:
      "Splits base geometry from optional emissive enhancement. Set to Off to use the one-phase worker baseline for correctness and performance comparisons.",
    min: 0,
    max: 1,
    step: 1,
    defaultValue: DEFAULT_MAP_DEBUG_SETTINGS.voxelProgressiveMeshingEnabled,
    formatDisplay: (value) => (value <= 0 ? "One phase" : "Progressive"),
  },
  {
    key: "voxelEmissiveAttributesEnabled",
    section: "Diagnostics",
    label: "Diag: Emissive Attributes",
    description:
      "Temporary voxel-lighting diagnostic. 0 makes the client worker skip mesh-local emissive attribute baking, transfer, and geometry upload so client bake cost can be isolated. Emitter records are still decoded for runtime stats. Default 1 keeps normal behavior.",
    min: 0,
    max: 1,
    step: 1,
    defaultValue: DEFAULT_MAP_DEBUG_SETTINGS.voxelEmissiveAttributesEnabled,
    formatDisplay: (value) => (value <= 0 ? "Off" : "On"),
  },
];
