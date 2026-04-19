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
  mode: "terrain" | "voxel";
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
    cachedTerrain: number;
    cachedVoxels: number;
    queued: number;
  };
  memoryByLod: Partial<Record<1 | 2 | 4 | 8 | 16 | 32, number>>;
  jsHeapBytes: number | null;
  warmCacheCount: {
    terrain: number;
    voxels: number;
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
  };
};

export interface MapDebugSettings {
  frameRateCapFps: number;
  idleFrameRateCapFps: number;
  lodUnloadHysteresis: number;
  maxConcurrentVoxelFetches: number;
  maxConcurrentTerrainFetches: number;
  voxelAoIntensity: number;
  voxelFocusStickyMs: number;
  voxelFocusSmoothAlpha: number;
  voxelLodHysteresisRatio: number;
  voxelBehindCameraDotStart: number;
  terrainLodHysteresisRatio: number;
  terrainMeshBuildBudgetMs: number;
  maxTerrainMeshesPerFrame: number;
  voxelBehindCameraMaxMultiplier: number;
  voxelDetailRequestDebounceMs: number;
  voxelUnloadGraceMs: number;
  voxelMeshBuildBudgetMs: number;
  maxVoxelMeshesPerFrame: number;
  warmTerrainCacheMaxBytes: number;
  warmVoxelCacheLimitBytes: number;
}

export interface MapDebugParameterDefinition {
  key: keyof MapDebugSettings;
  section: "Loading" | "LOD" | "Focus" | "Memory";
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
  frameRateCapFps: 60,
  idleFrameRateCapFps: 15,
  lodUnloadHysteresis: 1.5,
  maxConcurrentVoxelFetches: 8,
  maxConcurrentTerrainFetches: 4,
  voxelAoIntensity: 1,
  voxelFocusStickyMs: 1500,
  voxelFocusSmoothAlpha: 0.6,
  voxelLodHysteresisRatio: 0.12,
  voxelBehindCameraDotStart: -0.25,
  terrainLodHysteresisRatio: 0.12,
  terrainMeshBuildBudgetMs: 4,
  maxTerrainMeshesPerFrame: 2,
  voxelBehindCameraMaxMultiplier: 1.1,
  voxelDetailRequestDebounceMs: 180,
  voxelUnloadGraceMs: 750,
  voxelMeshBuildBudgetMs: 5,
  maxVoxelMeshesPerFrame: 8,
  warmTerrainCacheMaxBytes: 256 * MB,
  warmVoxelCacheLimitBytes: 512 * MB,
};

export function createEmptyChunkStats(mode: "terrain" | "voxel"): ChunkStats {
  return {
    loading: 0,
    loaded: 0,
    fps: 0,
    focusLod: 1,
    mode,
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
      cachedTerrain: 0,
      cachedVoxels: 0,
      queued: 0,
    },
    memoryByLod: {},
    jsHeapBytes: null,
    warmCacheCount: {
      terrain: 0,
      voxels: 0,
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
    },
  };
}

export const MAP_DEBUG_PARAMETER_DEFINITIONS: MapDebugParameterDefinition[] = [
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
];
