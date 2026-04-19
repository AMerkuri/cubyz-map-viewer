import {
  DEFAULT_MAP_DEBUG_SETTINGS,
  type MapDebugSettings,
} from "./world-view-debug.js";

export const DEFAULT_VOXEL_RENDER_DISTANCE = 19200;
export const DEFAULT_MIN_RENDERED_VOXEL_LOD = 1;
const GRAPHICS_SETTINGS_STORAGE_KEY = "cubyz-map-viewer.graphics-settings";
const GRAPHICS_SETTINGS_STORAGE_VERSION = 2;

type StoredBiomeLabelsByMode = {
  terrain: boolean;
  voxel: boolean;
};

type StoredLayerVisibility = {
  players: boolean;
  spawn: boolean;
  debug: boolean;
  showTerrain: boolean;
  showVoxelTerrain: boolean;
  biomeLabelsByMode: StoredBiomeLabelsByMode;
};

type StoredGraphicsSettings = {
  renderDistance: number;
  voxelLod1MaxDist: number;
  minRenderedVoxelLod: number;
  mapDebugSettings: MapDebugSettings;
  parameterVisibility: {
    chunkBorders: boolean;
    voxelHeightLabels: boolean;
  };
  layerVisibility: StoredLayerVisibility;
};

type StoredGraphicsSettingsPayload = StoredGraphicsSettings & {
  version: number;
};

function readFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function sanitizeBiomeLabelsByMode(value: unknown): StoredBiomeLabelsByMode {
  const source = value && typeof value === "object" ? value : {};
  return {
    terrain: readBoolean((source as Record<string, unknown>).terrain, true),
    voxel: readBoolean((source as Record<string, unknown>).voxel, false),
  };
}

function sanitizeLayerVisibility(value: unknown): StoredLayerVisibility {
  const source = value && typeof value === "object" ? value : {};
  return {
    players: readBoolean((source as Record<string, unknown>).players, true),
    spawn: readBoolean((source as Record<string, unknown>).spawn, true),
    debug: readBoolean((source as Record<string, unknown>).debug, false),
    showTerrain: readBoolean(
      (source as Record<string, unknown>).showTerrain,
      true,
    ),
    showVoxelTerrain: readBoolean(
      (source as Record<string, unknown>).showVoxelTerrain,
      false,
    ),
    biomeLabelsByMode: sanitizeBiomeLabelsByMode(
      (source as Record<string, unknown>).biomeLabelsByMode,
    ),
  };
}

function sanitizeMapDebugSettings(value: unknown): MapDebugSettings {
  const source = value && typeof value === "object" ? value : {};
  const settings = { ...DEFAULT_MAP_DEBUG_SETTINGS };

  for (const [key, defaultValue] of Object.entries(
    DEFAULT_MAP_DEBUG_SETTINGS,
  )) {
    settings[key as keyof MapDebugSettings] = readFiniteNumber(
      (source as Record<string, unknown>)[key],
      defaultValue,
    );
  }

  return settings;
}

export function readStoredGraphicsSettings(): StoredGraphicsSettings | null {
  try {
    const raw = window.localStorage.getItem(GRAPHICS_SETTINGS_STORAGE_KEY);
    if (raw === null) return null;

    const parsed = JSON.parse(raw) as StoredGraphicsSettingsPayload | null;
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      (parsed.version !== GRAPHICS_SETTINGS_STORAGE_VERSION &&
        parsed.version !== 1)
    ) {
      return null;
    }

    const parameterVisibility =
      parsed.parameterVisibility &&
      typeof parsed.parameterVisibility === "object"
        ? (parsed.parameterVisibility as Record<string, unknown>)
        : {};

    return {
      renderDistance: readFiniteNumber(
        parsed.renderDistance,
        DEFAULT_VOXEL_RENDER_DISTANCE,
      ),
      voxelLod1MaxDist: readFiniteNumber(parsed.voxelLod1MaxDist, 600),
      minRenderedVoxelLod: readFiniteNumber(
        parsed.minRenderedVoxelLod,
        DEFAULT_MIN_RENDERED_VOXEL_LOD,
      ),
      mapDebugSettings: sanitizeMapDebugSettings(parsed.mapDebugSettings),
      parameterVisibility: {
        chunkBorders: readBoolean(parameterVisibility.chunkBorders, false),
        voxelHeightLabels: readBoolean(
          parameterVisibility.voxelHeightLabels,
          false,
        ),
      },
      layerVisibility: sanitizeLayerVisibility(parsed.layerVisibility),
    };
  } catch {
    return null;
  }
}

export function writeStoredGraphicsSettings(
  settings: StoredGraphicsSettings,
): void {
  try {
    const payload: StoredGraphicsSettingsPayload = {
      version: GRAPHICS_SETTINGS_STORAGE_VERSION,
      ...settings,
    };
    window.localStorage.setItem(
      GRAPHICS_SETTINGS_STORAGE_KEY,
      JSON.stringify(payload),
    );
  } catch {
    // Ignore storage failures so the viewer still works in locked-down browsers.
  }
}
