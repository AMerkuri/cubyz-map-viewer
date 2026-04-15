import type { MapDebugSettings } from "../debug.js";

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
      | "maxConcurrentTerrainFetches"
      | "terrainMeshBuildBudgetMs"
      | "maxTerrainMeshesPerFrame"
      | "maxConcurrentVoxelFetches"
      | "voxelAoIntensity"
      | "terrainLodHysteresisRatio"
      | "voxelDetailRequestDebounceMs"
      | "voxelUnloadGraceMs"
      | "voxelMeshBuildBudgetMs"
      | "maxVoxelMeshesPerFrame"
      | "lodUnloadHysteresis"
      | "voxelBehindCameraDotStart"
      | "voxelBehindCameraMaxMultiplier"
      | "warmVoxelCacheMaxBytes"
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
      frameRateCapFps: 0,
      idleFrameRateCapFps: 15,
      maxConcurrentTerrainFetches: 6,
      terrainMeshBuildBudgetMs: 8,
      maxTerrainMeshesPerFrame: 4,
      maxConcurrentVoxelFetches: 20,
      voxelAoIntensity: 1,
      terrainLodHysteresisRatio: 0.08,
      voxelDetailRequestDebounceMs: 0,
      voxelUnloadGraceMs: 2000,
      voxelMeshBuildBudgetMs: 12,
      maxVoxelMeshesPerFrame: 16,
      lodUnloadHysteresis: 2.25,
      voxelBehindCameraDotStart: -0.45,
      voxelBehindCameraMaxMultiplier: 1.15,
      warmVoxelCacheMaxBytes: 1536 * MB,
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
      frameRateCapFps: 120,
      idleFrameRateCapFps: 15,
      maxConcurrentTerrainFetches: 5,
      terrainMeshBuildBudgetMs: 6,
      maxTerrainMeshesPerFrame: 3,
      maxConcurrentVoxelFetches: 12,
      voxelAoIntensity: 1,
      terrainLodHysteresisRatio: 0.1,
      voxelDetailRequestDebounceMs: 80,
      voxelUnloadGraceMs: 1200,
      voxelMeshBuildBudgetMs: 8,
      maxVoxelMeshesPerFrame: 12,
      lodUnloadHysteresis: 1.75,
      voxelBehindCameraDotStart: -0.3,
      voxelBehindCameraMaxMultiplier: 1.35,
      warmVoxelCacheMaxBytes: 768 * MB,
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
      frameRateCapFps: 60,
      idleFrameRateCapFps: 15,
      maxConcurrentTerrainFetches: 4,
      terrainMeshBuildBudgetMs: 4,
      maxTerrainMeshesPerFrame: 2,
      maxConcurrentVoxelFetches: 8,
      voxelAoIntensity: 1,
      terrainLodHysteresisRatio: 0.12,
      voxelDetailRequestDebounceMs: 180,
      voxelUnloadGraceMs: 750,
      voxelMeshBuildBudgetMs: 5,
      maxVoxelMeshesPerFrame: 8,
      lodUnloadHysteresis: 1.5,
      voxelBehindCameraDotStart: -0.15,
      voxelBehindCameraMaxMultiplier: 1.75,
      warmVoxelCacheMaxBytes: 512 * MB,
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
      frameRateCapFps: 40,
      idleFrameRateCapFps: 15,
      maxConcurrentTerrainFetches: 3,
      terrainMeshBuildBudgetMs: 3,
      maxTerrainMeshesPerFrame: 2,
      maxConcurrentVoxelFetches: 6,
      voxelAoIntensity: 1,
      terrainLodHysteresisRatio: 0.16,
      voxelDetailRequestDebounceMs: 320,
      voxelUnloadGraceMs: 400,
      voxelMeshBuildBudgetMs: 3,
      maxVoxelMeshesPerFrame: 5,
      lodUnloadHysteresis: 1.25,
      voxelBehindCameraDotStart: 0.05,
      voxelBehindCameraMaxMultiplier: 2.2,
      warmVoxelCacheMaxBytes: 256 * MB,
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
      frameRateCapFps: 30,
      idleFrameRateCapFps: 15,
      maxConcurrentTerrainFetches: 2,
      terrainMeshBuildBudgetMs: 2,
      maxTerrainMeshesPerFrame: 1,
      maxConcurrentVoxelFetches: 4,
      voxelAoIntensity: 1,
      terrainLodHysteresisRatio: 0.2,
      voxelDetailRequestDebounceMs: 450,
      voxelUnloadGraceMs: 200,
      voxelMeshBuildBudgetMs: 2,
      maxVoxelMeshesPerFrame: 3,
      lodUnloadHysteresis: 1.1,
      voxelBehindCameraDotStart: 0.2,
      voxelBehindCameraMaxMultiplier: 2.75,
      warmVoxelCacheMaxBytes: 128 * MB,
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
