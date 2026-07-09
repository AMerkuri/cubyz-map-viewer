import type { MapDebugSettings } from "./world-view-debug.js";

const MB = 1024 * 1024;

export type GraphicsPresetId =
  | "extreme"
  | "quality"
  | "balanced"
  | "performance"
  | "ultra-performance";

export type GraphicsPreset = {
  id: GraphicsPresetId;
  label: string;
  description: string;
  renderDistance: number;
  voxelLod1MaxDist: number;
  minRenderedVoxelLod: number;
  debugSettings: Partial<
    Pick<
      MapDebugSettings,
      | "frameRateCapFps"
      | "idleFrameRateCapFps"
      | "atmosphereTimeOfDay"
      | "atmosphereQuality"
      | "blockLightQuality"
      | "maxConcurrentTerrainFetches"
      | "terrainMeshBuildBudgetMs"
      | "maxTerrainMeshesPerFrame"
      | "maxConcurrentVoxelFetches"
      | "voxelTopAoIntensity"
      | "voxelWallAoIntensity"
      | "terrainLodHysteresisRatio"
      | "voxelDetailRequestDebounceMs"
      | "voxelUnloadGraceMs"
      | "voxelMeshBuildBudgetMs"
      | "maxVoxelMeshesPerFrame"
      | "lodUnloadHysteresis"
      | "voxelBehindCameraDotStart"
      | "voxelBehindCameraMaxMultiplier"
      | "lodReferenceFov"
      | "lodReferenceViewportHeight"
      | "warmTerrainCacheMaxBytes"
      | "warmVoxelCacheLimitBytes"
    >
  >;
};

export const GRAPHICS_PRESETS: readonly GraphicsPreset[] = [
  {
    id: "extreme",
    label: "Extreme",
    description:
      "Push voxel quality, distance, and cache use close to the limit.",
    renderDistance: 38400,
    voxelLod1MaxDist: 1150,
    minRenderedVoxelLod: 1,
    debugSettings: {
      atmosphereTimeOfDay: 12,
      atmosphereQuality: 2,
      blockLightQuality: 2,
      frameRateCapFps: 0,
      idleFrameRateCapFps: 15,
      maxConcurrentTerrainFetches: 6,
      terrainMeshBuildBudgetMs: 8,
      maxTerrainMeshesPerFrame: 4,
      maxConcurrentVoxelFetches: 20,
      voxelTopAoIntensity: 1,
      voxelWallAoIntensity: 0.5,
      terrainLodHysteresisRatio: 0.08,
      voxelDetailRequestDebounceMs: 0,
      voxelUnloadGraceMs: 2000,
      voxelMeshBuildBudgetMs: 12,
      maxVoxelMeshesPerFrame: 16,
      lodUnloadHysteresis: 2.25,
      voxelBehindCameraDotStart: -1,
      voxelBehindCameraMaxMultiplier: 1,
      lodReferenceFov: 75,
      lodReferenceViewportHeight: 720,
      warmTerrainCacheMaxBytes: 768 * MB,
      warmVoxelCacheLimitBytes: 1536 * MB,
    },
  },
  {
    id: "quality",
    label: "Quality",
    description: "Prioritize visual quality without pushing every limit.",
    renderDistance: 25600,
    voxelLod1MaxDist: 900,
    minRenderedVoxelLod: 1,
    debugSettings: {
      atmosphereTimeOfDay: 12,
      atmosphereQuality: 2,
      blockLightQuality: 2,
      frameRateCapFps: 120,
      idleFrameRateCapFps: 15,
      maxConcurrentTerrainFetches: 5,
      terrainMeshBuildBudgetMs: 6,
      maxTerrainMeshesPerFrame: 3,
      maxConcurrentVoxelFetches: 12,
      voxelTopAoIntensity: 1,
      voxelWallAoIntensity: 0.5,
      terrainLodHysteresisRatio: 0.1,
      voxelDetailRequestDebounceMs: 80,
      voxelUnloadGraceMs: 1200,
      voxelMeshBuildBudgetMs: 8,
      maxVoxelMeshesPerFrame: 12,
      lodUnloadHysteresis: 1.75,
      voxelBehindCameraDotStart: -0.9,
      voxelBehindCameraMaxMultiplier: 1.05,
      lodReferenceFov: 65,
      lodReferenceViewportHeight: 2400,
      warmTerrainCacheMaxBytes: 384 * MB,
      warmVoxelCacheLimitBytes: 768 * MB,
    },
  },
  {
    id: "balanced",
    label: "Balanced",
    description: "Current default tradeoff between visuals, memory, and FPS.",
    renderDistance: 19200,
    voxelLod1MaxDist: 600,
    minRenderedVoxelLod: 1,
    debugSettings: {
      atmosphereTimeOfDay: 12,
      atmosphereQuality: 1,
      blockLightQuality: 1,
      frameRateCapFps: 60,
      idleFrameRateCapFps: 15,
      maxConcurrentTerrainFetches: 4,
      terrainMeshBuildBudgetMs: 4,
      maxTerrainMeshesPerFrame: 2,
      maxConcurrentVoxelFetches: 8,
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
      lodReferenceFov: 60,
      lodReferenceViewportHeight: 2880,
      warmTerrainCacheMaxBytes: 256 * MB,
      warmVoxelCacheLimitBytes: 512 * MB,
    },
  },
  {
    id: "performance",
    label: "Performance",
    description:
      "Lower cost settings for steadier FPS and less memory pressure.",
    renderDistance: 12800,
    voxelLod1MaxDist: 600,
    minRenderedVoxelLod: 2,
    debugSettings: {
      atmosphereTimeOfDay: 12,
      atmosphereQuality: 1,
      blockLightQuality: 1,
      frameRateCapFps: 40,
      idleFrameRateCapFps: 15,
      maxConcurrentTerrainFetches: 3,
      terrainMeshBuildBudgetMs: 3,
      maxTerrainMeshesPerFrame: 2,
      maxConcurrentVoxelFetches: 6,
      voxelTopAoIntensity: 0,
      voxelWallAoIntensity: 0,
      terrainLodHysteresisRatio: 0.16,
      voxelDetailRequestDebounceMs: 320,
      voxelUnloadGraceMs: 400,
      voxelMeshBuildBudgetMs: 3,
      maxVoxelMeshesPerFrame: 5,
      lodUnloadHysteresis: 1.25,
      voxelBehindCameraDotStart: -0.2,
      voxelBehindCameraMaxMultiplier: 1.1,
      lodReferenceFov: 50,
      lodReferenceViewportHeight: 3600,
      warmTerrainCacheMaxBytes: 128 * MB,
      warmVoxelCacheLimitBytes: 256 * MB,
    },
  },
  {
    id: "ultra-performance",
    label: "Ultra Performance",
    description: "Highest FPS preset with aggressive distance and detail cuts.",
    renderDistance: 6400,
    voxelLod1MaxDist: 600,
    minRenderedVoxelLod: 4,
    debugSettings: {
      atmosphereTimeOfDay: 12,
      atmosphereQuality: 0,
      blockLightQuality: 0,
      frameRateCapFps: 40,
      idleFrameRateCapFps: 15,
      maxConcurrentTerrainFetches: 2,
      terrainMeshBuildBudgetMs: 2,
      maxTerrainMeshesPerFrame: 1,
      maxConcurrentVoxelFetches: 4,
      voxelTopAoIntensity: 0,
      voxelWallAoIntensity: 0,
      terrainLodHysteresisRatio: 0.2,
      voxelDetailRequestDebounceMs: 450,
      voxelUnloadGraceMs: 200,
      voxelMeshBuildBudgetMs: 2,
      maxVoxelMeshesPerFrame: 3,
      lodUnloadHysteresis: 1.1,
      voxelBehindCameraDotStart: -0.15,
      voxelBehindCameraMaxMultiplier: 1.15,
      lodReferenceFov: 40,
      lodReferenceViewportHeight: 4320,
      warmTerrainCacheMaxBytes: 64 * MB,
      warmVoxelCacheLimitBytes: 128 * MB,
    },
  },
] as const;

export function matchesGraphicsPreset(args: {
  preset: GraphicsPreset;
  renderDistance: number;
  voxelLod1MaxDist: number;
  minRenderedVoxelLod: number;
  debugSettings: MapDebugSettings;
}): boolean {
  const {
    preset,
    renderDistance,
    voxelLod1MaxDist,
    minRenderedVoxelLod,
    debugSettings,
  } = args;
  if (renderDistance !== preset.renderDistance) return false;
  if (minRenderedVoxelLod !== preset.minRenderedVoxelLod) return false;
  if (
    minRenderedVoxelLod === 1 &&
    voxelLod1MaxDist !== preset.voxelLod1MaxDist
  ) {
    return false;
  }
  for (const [key, value] of Object.entries(preset.debugSettings)) {
    if (debugSettings[key as keyof MapDebugSettings] !== value) return false;
  }
  return true;
}
