import {
  createContext,
  use,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  type ChunkStats,
  createEmptyChunkStats,
  DEFAULT_MAP_DEBUG_SETTINGS,
  type LoadingBreakdown,
  type MapDebugSettings,
} from "../../lib/world-view-debug.js";
import {
  GRAPHICS_PRESETS,
  type GraphicsPreset,
  matchesGraphicsPreset,
} from "../../lib/world-view-graphics-presets.js";
import {
  DEFAULT_MIN_RENDERED_VOXEL_LOD,
  DEFAULT_VOXEL_RENDER_DISTANCE,
  readStoredGraphicsSettings,
  type StoredLayerVisibility,
  writeStoredGraphicsSettings,
} from "../../lib/world-view-storage.js";
import type {
  FlyToRequest,
  LayerVisibility,
  WorldViewMode,
} from "../../types/world-view.js";

type WorldControlsState = {
  view: WorldViewMode;
  chunkIndexEnabled: boolean;
  layerVisibility: LayerVisibility;
  mapDebugSettings: MapDebugSettings;
  renderDistance: number;
  voxelLod1MaxDist: number;
  minRenderedVoxelLod: number;
  chunkStats: ChunkStats;
  loadingBreakdown: LoadingBreakdown;
  flyToRequest: FlyToRequest | null;
};

type WorldControlsContextValue = {
  state: WorldControlsState;
  activeGraphicsPresetId: string | null;
  applyGraphicsPreset: (preset: GraphicsPreset) => void;
  updateLayerVisibility: (next: LayerVisibility) => void;
  updateMapDebugSettings: (next: MapDebugSettings) => void;
  updateRenderDistance: (value: number) => void;
  updateVoxelLod1MaxDist: (value: number) => void;
  updateMinRenderedVoxelLod: (value: number) => void;
  setChunkBorders: (active: boolean) => void;
  setVoxelHeightLabels: (active: boolean) => void;
  flyToPosition: (
    pos: [number, number, number],
    preserveHeight?: boolean,
  ) => void;
  setChunkStats: (stats: ChunkStats) => void;
  setLoadingBreakdown: (loadingBreakdown: LoadingBreakdown) => void;
};

type WorldControlsProviderProps = {
  initialMode: WorldViewMode;
  children: React.ReactNode;
};

type WorldControlsInit = {
  initialMode: WorldViewMode;
  stored: ReturnType<typeof readStoredGraphicsSettings>;
};

type WorldControlsAction =
  | { type: "set-layer-visibility"; next: LayerVisibility }
  | { type: "set-map-debug-settings"; next: MapDebugSettings }
  | { type: "set-render-distance"; value: number }
  | { type: "set-voxel-lod1-max-dist"; value: number }
  | { type: "set-min-rendered-voxel-lod"; value: number }
  | { type: "fly-to"; pos: [number, number, number]; preserveHeight: boolean }
  | { type: "set-chunk-stats"; stats: ChunkStats }
  | { type: "set-loading-breakdown"; loadingBreakdown: LoadingBreakdown };

const WorldControlsContext = createContext<WorldControlsContextValue | null>(
  null,
);

function createInitialLayerVisibility(
  initialMode: WorldViewMode,
  storedLayerVisibility: StoredLayerVisibility | null,
  storedChunkBorders: boolean,
  storedVoxelHeightLabels: boolean,
): LayerVisibility {
  return {
    biomeLabels:
      storedLayerVisibility?.biomeLabelsByMode?.[initialMode] ??
      initialMode === "terrain",
    players: storedLayerVisibility?.players ?? true,
    spawn: storedLayerVisibility?.spawn ?? true,
    debug: storedLayerVisibility?.debug ?? false,
    chunkBorders: storedChunkBorders,
    showTerrain: storedLayerVisibility?.showTerrain ?? true,
    showVoxelTerrain: storedLayerVisibility?.showVoxelTerrain ?? false,
    voxelHeightLabels: storedVoxelHeightLabels,
  };
}

function createInitialBiomeLabelsByMode(
  storedLayerVisibility: StoredLayerVisibility | null,
): { terrain: boolean; voxel: boolean } {
  return {
    terrain: storedLayerVisibility?.biomeLabelsByMode?.terrain ?? true,
    voxel: storedLayerVisibility?.biomeLabelsByMode?.voxel ?? false,
  };
}

function createInitialState({
  initialMode,
  stored,
}: WorldControlsInit): WorldControlsState {
  return {
    view: initialMode,
    chunkIndexEnabled: true,
    layerVisibility: createInitialLayerVisibility(
      initialMode,
      stored?.layerVisibility ?? null,
      stored?.parameterVisibility.chunkBorders ?? false,
      stored?.parameterVisibility.voxelHeightLabels ?? false,
    ),
    mapDebugSettings: stored?.mapDebugSettings ?? DEFAULT_MAP_DEBUG_SETTINGS,
    renderDistance: stored?.renderDistance ?? DEFAULT_VOXEL_RENDER_DISTANCE,
    voxelLod1MaxDist: stored?.voxelLod1MaxDist ?? 600,
    minRenderedVoxelLod:
      stored?.minRenderedVoxelLod ?? DEFAULT_MIN_RENDERED_VOXEL_LOD,
    chunkStats: createEmptyChunkStats(initialMode),
    loadingBreakdown: {
      terrain: 0,
      voxels: 0,
      fetchQueue: 0,
      meshQueue: 0,
    },
    flyToRequest: null,
  };
}

function worldControlsReducer(
  state: WorldControlsState,
  action: WorldControlsAction,
): WorldControlsState {
  switch (action.type) {
    case "set-layer-visibility": {
      return {
        ...state,
        layerVisibility: action.next,
        chunkStats: action.next.debug
          ? state.chunkStats
          : createEmptyChunkStats(state.view),
      };
    }
    case "set-map-debug-settings":
      return { ...state, mapDebugSettings: action.next };
    case "set-render-distance":
      return { ...state, renderDistance: action.value };
    case "set-voxel-lod1-max-dist":
      return { ...state, voxelLod1MaxDist: action.value };
    case "set-min-rendered-voxel-lod":
      return { ...state, minRenderedVoxelLod: action.value };
    case "fly-to":
      return {
        ...state,
        flyToRequest: {
          pos: action.pos,
          preserveHeight: action.preserveHeight,
          key: (state.flyToRequest?.key ?? 0) + 1,
        },
      };
    case "set-chunk-stats":
      return { ...state, chunkStats: action.stats };
    case "set-loading-breakdown":
      return { ...state, loadingBreakdown: action.loadingBreakdown };
    default:
      return state;
  }
}

export function WorldControlsProvider({
  initialMode,
  children,
}: WorldControlsProviderProps) {
  const [stored] = useState(() => readStoredGraphicsSettings());

  const biomeLabelsByModeRef = useRef<{ terrain: boolean; voxel: boolean }>({
    ...createInitialBiomeLabelsByMode(stored?.layerVisibility ?? null),
  });

  const [state, dispatch] = useReducer(
    worldControlsReducer,
    { initialMode, stored },
    createInitialState,
  );

  useEffect(() => {
    biomeLabelsByModeRef.current[state.view] =
      state.layerVisibility.biomeLabels;
    writeStoredGraphicsSettings({
      renderDistance: state.renderDistance,
      voxelLod1MaxDist: state.voxelLod1MaxDist,
      minRenderedVoxelLod: state.minRenderedVoxelLod,
      mapDebugSettings: state.mapDebugSettings,
      parameterVisibility: {
        chunkBorders: state.layerVisibility.chunkBorders,
        voxelHeightLabels: state.layerVisibility.voxelHeightLabels,
      },
      layerVisibility: {
        players: state.layerVisibility.players,
        spawn: state.layerVisibility.spawn,
        debug: state.layerVisibility.debug,
        showTerrain: state.layerVisibility.showTerrain,
        showVoxelTerrain: state.layerVisibility.showVoxelTerrain,
        biomeLabelsByMode: biomeLabelsByModeRef.current,
      },
    });
  }, [
    state.renderDistance,
    state.voxelLod1MaxDist,
    state.minRenderedVoxelLod,
    state.mapDebugSettings,
    state.layerVisibility.players,
    state.layerVisibility.spawn,
    state.layerVisibility.debug,
    state.layerVisibility.showTerrain,
    state.layerVisibility.showVoxelTerrain,
    state.layerVisibility.biomeLabels,
    state.view,
    state.layerVisibility.chunkBorders,
    state.layerVisibility.voxelHeightLabels,
  ]);

  const activeGraphicsPresetId = useMemo(() => {
    return (
      GRAPHICS_PRESETS.find((preset) =>
        matchesGraphicsPreset({
          preset,
          renderDistance: state.renderDistance,
          voxelLod1MaxDist: state.voxelLod1MaxDist,
          minRenderedVoxelLod: state.minRenderedVoxelLod,
          debugSettings: state.mapDebugSettings,
        }),
      )?.id ?? null
    );
  }, [
    state.renderDistance,
    state.voxelLod1MaxDist,
    state.minRenderedVoxelLod,
    state.mapDebugSettings,
  ]);

  const value = useMemo<WorldControlsContextValue>(() => {
    return {
      state,
      activeGraphicsPresetId,
      applyGraphicsPreset(preset) {
        dispatch({ type: "set-render-distance", value: preset.renderDistance });
        dispatch({
          type: "set-min-rendered-voxel-lod",
          value: preset.minRenderedVoxelLod,
        });
        if (preset.minRenderedVoxelLod === 1) {
          dispatch({
            type: "set-voxel-lod1-max-dist",
            value: preset.voxelLod1MaxDist,
          });
        }
        dispatch({
          type: "set-map-debug-settings",
          next: {
            ...state.mapDebugSettings,
            ...preset.debugSettings,
          },
        });
      },
      updateLayerVisibility(next) {
        biomeLabelsByModeRef.current[state.view] = next.biomeLabels;
        dispatch({ type: "set-layer-visibility", next });
      },
      updateMapDebugSettings(next) {
        dispatch({ type: "set-map-debug-settings", next });
      },
      updateRenderDistance(value) {
        dispatch({ type: "set-render-distance", value });
      },
      updateVoxelLod1MaxDist(value) {
        dispatch({ type: "set-voxel-lod1-max-dist", value });
      },
      updateMinRenderedVoxelLod(value) {
        dispatch({ type: "set-min-rendered-voxel-lod", value });
      },
      setChunkBorders(active) {
        dispatch({
          type: "set-layer-visibility",
          next: {
            ...state.layerVisibility,
            chunkBorders: active,
          },
        });
      },
      setVoxelHeightLabels(active) {
        dispatch({
          type: "set-layer-visibility",
          next: {
            ...state.layerVisibility,
            voxelHeightLabels: active,
          },
        });
      },
      flyToPosition(pos, preserveHeight = false) {
        dispatch({ type: "fly-to", pos, preserveHeight });
      },
      setChunkStats(stats) {
        dispatch({ type: "set-chunk-stats", stats });
      },
      setLoadingBreakdown(loadingBreakdown) {
        dispatch({ type: "set-loading-breakdown", loadingBreakdown });
      },
    };
  }, [activeGraphicsPresetId, state]);

  return <WorldControlsContext value={value}>{children}</WorldControlsContext>;
}

export function useWorldControls() {
  const context = use(WorldControlsContext);
  if (context === null) {
    throw new Error(
      "useWorldControls must be used within WorldControlsProvider",
    );
  }
  return context;
}

export function useWorldControlsState() {
  return useWorldControls().state;
}

export function useWorldControlsActions() {
  const {
    applyGraphicsPreset,
    flyToPosition,
    setChunkBorders,
    setChunkStats,
    setLoadingBreakdown,
    setVoxelHeightLabels,
    updateLayerVisibility,
    updateMapDebugSettings,
    updateMinRenderedVoxelLod,
    updateRenderDistance,
    updateVoxelLod1MaxDist,
  } = useWorldControls();

  return {
    applyGraphicsPreset,
    flyToPosition,
    setChunkBorders,
    setChunkStats,
    setLoadingBreakdown,
    setVoxelHeightLabels,
    updateLayerVisibility,
    updateMapDebugSettings,
    updateMinRenderedVoxelLod,
    updateRenderDistance,
    updateVoxelLod1MaxDist,
  };
}
