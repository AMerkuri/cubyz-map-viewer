import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  InfoPanel,
  InfoPanelContent,
} from "../features/world-view/components/InfoPanel.js";
import {
  LayerControls,
  type LayerVisibility,
} from "../features/world-view/components/LayerControls.js";
import { ViewToggle } from "../features/world-view/components/ViewToggle.js";
import {
  type InitialCameraState,
  World3DView,
} from "../features/world-view/components/World3DView.js";
import {
  type ChunkStats,
  createEmptyChunkStats,
  createEmptyLoadingBreakdown,
  DEFAULT_MAP_DEBUG_SETTINGS,
  type LoadingBreakdown,
  type MapDebugSettings,
} from "../features/world-view/debug.js";
import type { PlayerData } from "../features/world-view/hooks/usePlayers.js";
import { usePlayers } from "../features/world-view/hooks/usePlayers.js";
import {
  type TerrainUpdatesBatchEvent,
  useWebSocket,
} from "../features/world-view/hooks/useWebSocket.js";
import { useWorldData } from "../features/world-view/hooks/useWorldData.js";
import {
  GRAPHICS_PRESETS,
  type GraphicsPreset,
  matchesGraphicsPreset,
} from "../features/world-view/lib/graphics-presets.js";
import { OverlayPanel } from "../shared/ui/OverlayPanel.js";
import { uiTheme } from "../shared/ui/theme.js";
import { MobileHudTray } from "./MobileHudTray.js";
import {
  DebugParametersContent,
  DebugStatsContent,
  MapControlsContent,
} from "./mobileHudContents.js";

type ShareLocationState = {
  mode: "terrain" | "voxel";
  pos: [number, number, number];
  zoom: number;
  theta: number;
  phi: number;
};

const DEFAULT_VOXEL_RENDER_DISTANCE = 19200;
const DEFAULT_MIN_RENDERED_VOXEL_LOD = 1;
const GRAPHICS_SETTINGS_STORAGE_KEY = "cubyz-map-viewer.graphics-settings";
const GRAPHICS_SETTINGS_STORAGE_VERSION = 1;
const COMPACT_VIEWPORT_MAX_WIDTH_PX = 768;
const COMPACT_VIEWPORT_MAX_HEIGHT_PX = 720;

type StoredGraphicsSettings = {
  renderDistance: number;
  voxelLod1MaxDist: number;
  minRenderedVoxelLod: number;
  mapDebugSettings: MapDebugSettings;
  parameterVisibility: {
    chunkBorders: boolean;
    voxelHeightLabels: boolean;
  };
};

type StoredGraphicsSettingsPayload = StoredGraphicsSettings & {
  version: number;
};

const MapDebugParameters = lazy(async () =>
  import("../features/world-view/components/MapDebugParameters.js").then(
    ({ MapDebugParameters }) => ({ default: MapDebugParameters }),
  ),
);

function useCompactViewport(): boolean {
  const [compact, setCompact] = useState(() => detectCompactViewport());

  useEffect(() => {
    const updateCompact = () => {
      setCompact(detectCompactViewport());
    };

    updateCompact();
    window.addEventListener("resize", updateCompact);
    window.addEventListener("orientationchange", updateCompact);
    return () => {
      window.removeEventListener("resize", updateCompact);
      window.removeEventListener("orientationchange", updateCompact);
    };
  }, []);

  return compact;
}

function detectCompactViewport(): boolean {
  if (typeof window === "undefined") return false;

  return (
    window.innerWidth < COMPACT_VIEWPORT_MAX_WIDTH_PX ||
    window.innerHeight <= COMPACT_VIEWPORT_MAX_HEIGHT_PX
  );
}

function readFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
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

function readStoredGraphicsSettings(): StoredGraphicsSettings | null {
  try {
    const raw = window.localStorage.getItem(GRAPHICS_SETTINGS_STORAGE_KEY);
    if (raw === null) return null;

    const parsed = JSON.parse(raw) as StoredGraphicsSettingsPayload | null;
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      parsed.version !== GRAPHICS_SETTINGS_STORAGE_VERSION
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
    };
  } catch {
    return null;
  }
}

function writeStoredGraphicsSettings(settings: StoredGraphicsSettings): void {
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

function readInitialMode(): "terrain" | "voxel" {
  const p = new URLSearchParams(window.location.search);
  return p.get("mode") === "voxel" ? "voxel" : "terrain";
}

function readInitialCameraState(): InitialCameraState | null {
  const p = new URLSearchParams(window.location.search);
  const x = parseFloat(p.get("x") ?? "");
  const y = parseFloat(p.get("y") ?? "");
  const z = parseFloat(p.get("z") ?? "");
  const zoom = parseFloat(p.get("zoom") ?? "");
  const theta = parseFloat(p.get("theta") ?? "");
  const phi = parseFloat(p.get("phi") ?? "");
  if (
    !Number.isNaN(x) &&
    !Number.isNaN(y) &&
    !Number.isNaN(z) &&
    !Number.isNaN(zoom) &&
    !Number.isNaN(theta) &&
    !Number.isNaN(phi)
  ) {
    return { pos: [x, y, z], zoom, theta, phi };
  }
  return null;
}

function formatMemoryBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatNullableBytes(bytes: number | null): string {
  if (bytes === null) return "n/a";
  return formatMemoryBytes(Math.round(bytes));
}

function LoadingIndicator({
  visible,
  compact = false,
}: {
  visible: boolean;
  compact?: boolean;
}) {
  const [mounted, setMounted] = useState(visible);
  const [shown, setShown] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      const frame = window.requestAnimationFrame(() => {
        setShown(true);
      });
      return () => {
        window.cancelAnimationFrame(frame);
      };
    }

    setShown(false);
    const timeout = window.setTimeout(() => {
      setMounted(false);
    }, 180);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [visible]);

  if (!mounted) return null;

  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        left: compact ? 12 : undefined,
        top: compact ? 12 : undefined,
        right: compact ? undefined : 12,
        bottom: compact ? undefined : 12,
        zIndex: 1000,
        pointerEvents: "none",
        opacity: shown ? 1 : 0,
        transition: "opacity 180ms ease",
        willChange: "opacity",
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: 999,
          border: `3px solid color-mix(in srgb, ${uiTheme.accent.spinnerTop} 16%, transparent)`,
          borderTopColor: uiTheme.accent.spinnerTop,
          borderRightColor: uiTheme.accent.spinnerRight,
          animation: "cubyz-half-spin 0.8s linear infinite",
        }}
      />
    </div>
  );
}

function isLoadingBreakdownActive(loadingBreakdown: LoadingBreakdown): boolean {
  return (
    loadingBreakdown.terrain +
      loadingBreakdown.voxels +
      loadingBreakdown.fetchQueue +
      loadingBreakdown.meshQueue >
    0
  );
}

function StatsSectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 4,
        color: uiTheme.accent.text,
        fontWeight: 400,
      }}
    >
      {children}
    </div>
  );
}

function DebugStatsPanel({ chunkStats }: { chunkStats: ChunkStats }) {
  return (
    <OverlayPanel
      title="Stats"
      position={{ top: 54, right: 12 }}
      minWidth={250}
      maxWidth={360}
      collapsible={true}
      defaultCollapsed={true}
      contentStyle={{
        fontSize: 12,
        lineHeight: 1.25,
        color: uiTheme.text.secondary,
      }}
    >
      <div style={{ display: "grid", gap: 6 }}>
        <div>Mode: {chunkStats.mode === "terrain" ? "Terrain" : "Voxel"}</div>
        <div>Focus LOD: {chunkStats.focusLod}</div>
        <div>FPS: {chunkStats.fps}</div>
        <div>Loading chunks: {chunkStats.loading}</div>
        <div>Loaded chunks: {chunkStats.loaded}</div>

        <StatsSectionTitle>Loading breakdown</StatsSectionTitle>
        <div>Terrain loading: {chunkStats.loadingBreakdown.terrain}</div>
        <div>Voxel loading: {chunkStats.loadingBreakdown.voxels}</div>
        <div>Fetch queue: {chunkStats.loadingBreakdown.fetchQueue}</div>
        <div>Mesh queue: {chunkStats.loadingBreakdown.meshQueue}</div>

        <StatsSectionTitle>Voxel health</StatsSectionTitle>
        <div>Missing regions: {chunkStats.voxelHealth.missing}</div>
        <div>Failed regions: {chunkStats.voxelHealth.failed}</div>

        <StatsSectionTitle>Loaded by LOD</StatsSectionTitle>
        <div>
          {([1, 2, 4, 8, 16, 32] as const)
            .map((lod) => `L${lod}:${chunkStats.loadedByLod[lod] ?? 0}`)
            .join("  ")}
        </div>

        <StatsSectionTitle>Estimated Memory</StatsSectionTitle>
        <div>Total: {formatMemoryBytes(chunkStats.memoryBytes)}</div>
        <div>
          Terrain: {formatMemoryBytes(chunkStats.memoryBreakdown.terrain)}
        </div>
        <div>
          Voxels: {formatMemoryBytes(chunkStats.memoryBreakdown.voxels)}
        </div>
        <div>
          Terrain warm cache:{" "}
          {formatMemoryBytes(chunkStats.memoryBreakdown.cachedTerrain)} (
          {chunkStats.warmCacheCount.terrain})
        </div>
        <div>
          Voxel warm cache:{" "}
          {formatMemoryBytes(chunkStats.memoryBreakdown.cachedVoxels)} (
          {chunkStats.warmCacheCount.voxels})
        </div>
        <div>
          Queued: {formatMemoryBytes(chunkStats.memoryBreakdown.queued)}
        </div>
        <div>
          JS heap:{" "}
          {chunkStats.jsHeapBytes === null
            ? "n/a"
            : formatMemoryBytes(chunkStats.jsHeapBytes)}
        </div>

        <StatsSectionTitle>Memory by LOD</StatsSectionTitle>
        <div>
          {([1, 2, 4, 8, 16, 32] as const)
            .map(
              (lod) =>
                `L${lod}:${formatMemoryBytes(chunkStats.memoryByLod[lod] ?? 0)}`,
            )
            .join("  ")}
        </div>

        <StatsSectionTitle>Voxel Benchmark</StatsSectionTitle>
        <div>Samples: {chunkStats.voxelBenchmark.samples}</div>
        <div>
          Encoding: {chunkStats.voxelBenchmark.contentEncoding ?? "n/a"}
        </div>
        <div>
          Avg fetch: {chunkStats.voxelBenchmark.avgFetchMs.toFixed(1)} ms
        </div>
        <div>
          Avg decode: {chunkStats.voxelBenchmark.avgDecodeMs.toFixed(1)} ms
        </div>
        <div>
          Avg total: {chunkStats.voxelBenchmark.avgTotalMs.toFixed(1)} ms
        </div>
        <div>
          Avg transfer:{" "}
          {formatNullableBytes(chunkStats.voxelBenchmark.avgTransferBytes)}
        </div>
        <div>
          Avg encoded:{" "}
          {formatNullableBytes(chunkStats.voxelBenchmark.avgEncodedBodyBytes)}
        </div>
        <div>
          Avg decoded:{" "}
          {formatNullableBytes(chunkStats.voxelBenchmark.avgDecodedBodyBytes)}
        </div>
        <div>
          Avg worker input:{" "}
          {formatNullableBytes(chunkStats.voxelBenchmark.avgRawBufferBytes)}
        </div>
      </div>
    </OverlayPanel>
  );
}

function InstructionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        color: uiTheme.accent.text,
        fontWeight: 400,
        marginBottom: 2,
      }}
    >
      {children}
    </div>
  );
}

function MapControlsPanel(args: {
  view: "terrain" | "voxel";
  activeGraphicsPresetId: string | null;
  applyGraphicsPreset: (preset: GraphicsPreset) => void;
  layerVisibility: LayerVisibility;
  handleLayerVisibilityChange: (visibility: LayerVisibility) => void;
}) {
  const {
    view,
    activeGraphicsPresetId,
    applyGraphicsPreset,
    layerVisibility,
    handleLayerVisibilityChange,
  } = args;

  return (
    <OverlayPanel
      title="Map Controls"
      position={{ top: 12, left: 12 }}
      minWidth={250}
      maxWidth={350}
      collapsible={true}
      contentStyle={{ fontSize: 12, lineHeight: 1.25 }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {view === "voxel" && (
          <div style={{ display: "grid", gap: 6 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span
                style={{
                  color: uiTheme.accent.text,
                  fontWeight: 400,
                }}
              >
                Graphics Presets
              </span>
              <span style={{ color: uiTheme.text.muted, fontSize: 12 }}>
                {activeGraphicsPresetId === null ? "Custom" : ""}
              </span>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 6,
              }}
            >
              {GRAPHICS_PRESETS.map((preset) => {
                const active = preset.id === activeGraphicsPresetId;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyGraphicsPreset(preset)}
                    title={preset.description}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "8px 10px",
                      borderRadius: 0,
                      border: active
                        ? `2px solid ${uiTheme.accent.border}`
                        : `2px solid ${uiTheme.panel.buttonBorderMuted}`,
                      background: active
                        ? uiTheme.accent.surface
                        : uiTheme.panel.buttonBackgroundMuted,
                      color: active
                        ? uiTheme.text.onAccent
                        : uiTheme.text.secondary,
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: 400,
                      textAlign: "left",
                      boxShadow: "2px 2px 0 rgba(0,0,0,0.5)",
                      textTransform: "uppercase",
                    }}
                  >
                    <span
                      style={{
                        display: "inline-block",
                        width: 10,
                        height: 10,
                        flexShrink: 0,
                        border: active
                          ? `2px solid ${uiTheme.accent.border}`
                          : `2px solid ${uiTheme.panel.buttonBorderMuted}`,
                        background: active
                          ? uiTheme.accent.surfaceActive
                          : uiTheme.panel.buttonBackgroundMuted,
                      }}
                    />
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <LayerControls
          visibility={layerVisibility}
          onChange={handleLayerVisibilityChange}
          view={view}
        />
        <div
          style={{
            fontSize: 12,
            lineHeight: 1.25,
            color: uiTheme.text.secondary,
            display: "grid",
            gap: 8,
          }}
        >
          <div>
            <InstructionTitle>Mouse</InstructionTitle>
            <div>Left drag: pan</div>
            <div>Right drag: orbit</div>
            <div>Wheel / middle drag: zoom</div>
          </div>
          <div>
            <InstructionTitle>Keyboard</InstructionTitle>
            <div>W/A/S/D or arrows: move camera target</div>
            <div>Q / E: rotate around center</div>
            <div>Space: focus spawn</div>
          </div>
          <div>
            <InstructionTitle>Panels</InstructionTitle>
            <div>Grab a panel header to drag it around</div>
          </div>
        </div>
      </div>
    </OverlayPanel>
  );
}

function TopRightToolbar(args: {
  shareCopied: boolean;
  onShareLocation: () => void;
  view: "terrain" | "voxel";
  onViewChange: (next: "terrain" | "voxel") => void;
  compact?: boolean;
}) {
  const {
    shareCopied,
    onShareLocation,
    view,
    onViewChange,
    compact = false,
  } = args;

  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        right: 12,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: compact ? 8 : 10,
      }}
    >
      <button
        type="button"
        onClick={onShareLocation}
        style={{
          padding: compact ? "7px 12px" : "8px 14px",
          border: `2px solid ${shareCopied ? uiTheme.accent.border : uiTheme.panel.buttonBorder}`,
          borderRadius: 0,
          boxShadow: "3px 3px 0 rgba(0,0,0,0.55)",
          background: shareCopied
            ? uiTheme.accent.surfaceActive
            : uiTheme.panel.buttonBackground,
          backdropFilter: "blur(5px)",
          color: shareCopied ? uiTheme.text.onAccent : uiTheme.text.muted,
          fontSize: compact ? 12 : 13,
          fontWeight: 400,
          textTransform: "uppercase",
          cursor: "pointer",
        }}
      >
        {shareCopied ? "Copied" : "Copy Location"}
      </button>
      <ViewToggle view={view} onViewChange={onViewChange} compact={compact} />
    </div>
  );
}

function DebugParametersPanel(args: {
  view: "terrain" | "voxel";
  mapDebugSettings: MapDebugSettings;
  setMapDebugSettings: React.Dispatch<React.SetStateAction<MapDebugSettings>>;
  renderDistance: number;
  setRenderDistance: React.Dispatch<React.SetStateAction<number>>;
  voxelLod1MaxDist: number;
  setVoxelLod1MaxDist: React.Dispatch<React.SetStateAction<number>>;
  minRenderedVoxelLod: number;
  setMinRenderedVoxelLod: React.Dispatch<React.SetStateAction<number>>;
  layerVisibility: LayerVisibility;
  setLayerVisibility: React.Dispatch<React.SetStateAction<LayerVisibility>>;
}) {
  const {
    view,
    mapDebugSettings,
    setMapDebugSettings,
    renderDistance,
    setRenderDistance,
    voxelLod1MaxDist,
    setVoxelLod1MaxDist,
    minRenderedVoxelLod,
    setMinRenderedVoxelLod,
    layerVisibility,
    setLayerVisibility,
  } = args;

  return (
    <OverlayPanel
      title="Parameters"
      position={{ top: 108, right: 12 }}
      minWidth={250}
      maxWidth={360}
      collapsible={true}
      defaultCollapsed={true}
      contentStyle={{
        fontSize: 12,
        lineHeight: 1.25,
        color: uiTheme.text.secondary,
      }}
    >
      <Suspense fallback={<div>Loading parameters...</div>}>
        <MapDebugParameters
          view={view}
          settings={mapDebugSettings}
          onChange={setMapDebugSettings}
          renderDistance={renderDistance}
          onRenderDistanceChange={setRenderDistance}
          voxelLod1MaxDist={voxelLod1MaxDist}
          onVoxelLod1MaxDistChange={setVoxelLod1MaxDist}
          minRenderedVoxelLod={minRenderedVoxelLod}
          onMinRenderedVoxelLodChange={setMinRenderedVoxelLod}
          chunkBorders={layerVisibility.chunkBorders}
          voxelHeights={layerVisibility.voxelHeightLabels}
          onChunkBordersChange={(active) =>
            setLayerVisibility((prev) => ({
              ...prev,
              chunkBorders: active,
            }))
          }
          onVoxelHeightsChange={(active) =>
            setLayerVisibility((prev) => ({
              ...prev,
              voxelHeightLabels: active,
            }))
          }
        />
      </Suspense>
    </OverlayPanel>
  );
}

export function App() {
  const initialMode = readInitialMode();
  const initialCameraState = readInitialCameraState();
  const isCompactViewport = useCompactViewport();
  const restoredGraphicsSettingsRef = useRef<StoredGraphicsSettings | null>(
    null,
  );

  if (restoredGraphicsSettingsRef.current === null) {
    restoredGraphicsSettingsRef.current = readStoredGraphicsSettings();
  }

  const restoredGraphicsSettings = restoredGraphicsSettingsRef.current;

  const [view, setView] = useState<"terrain" | "voxel">(initialMode);
  const [flyToRequest, setFlyToRequest] = useState<{
    pos: [number, number, number];
    key: number;
  } | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [currentZoom, setCurrentZoom] = useState<number | null>(null);
  const [chunkStats, setChunkStats] = useState<ChunkStats>(() =>
    createEmptyChunkStats(initialMode),
  );
  const [loadingBreakdown, setLoadingBreakdown] = useState<LoadingBreakdown>(
    () => createEmptyLoadingBreakdown(),
  );
  const [chunkIndexEnabled, setChunkIndexEnabled] = useState(
    initialMode === "voxel",
  );
  const [mapDebugSettings, setMapDebugSettings] = useState<MapDebugSettings>(
    () =>
      restoredGraphicsSettings?.mapDebugSettings ?? DEFAULT_MAP_DEBUG_SETTINGS,
  );
  const worldData = useWorldData(chunkIndexEnabled);

  // HUD element updated directly — no React state, no re-renders on mouse move.
  const cursorHudRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<"terrain" | "voxel">(initialMode);
  viewRef.current = view;
  const biomeLabelsByModeRef = useRef<{ terrain: boolean; voxel: boolean }>({
    terrain: true,
    voxel: false,
  });
  const shareLocationRef = useRef<ShareLocationState | null>(null);

  // Stable callback: updates the HUD element directly without triggering any re-render.
  const handleCursorMove = useCallback(
    (pos: [number, number, number] | null) => {
      const el = cursorHudRef.current;
      if (!el) return;
      if (!pos) {
        el.style.display = "none";
        return;
      }
      el.style.display = "";
      el.textContent = `X ${pos[0]}  Y ${pos[1]}  Z ${pos[2]}`;
    },
    [],
  );

  const handleViewChange = useCallback((next: "terrain" | "voxel") => {
    const el = cursorHudRef.current;
    if (el) el.style.display = "none";
    setFlyToRequest(null);

    const currentView = viewRef.current;
    const nextBiomeLabels = biomeLabelsByModeRef.current[next];

    setLayerVisibility((prev) => {
      biomeLabelsByModeRef.current[currentView] = prev.biomeLabels;
      return {
        ...prev,
        biomeLabels: nextBiomeLabels,
      };
    });
    if (next === "voxel") {
      setChunkIndexEnabled(true);
    }
    setView(next);
  }, []);

  const handlePlayerClick = useCallback((player: PlayerData) => {
    setFlyToRequest((prev) => ({
      pos: player.position,
      key: (prev?.key ?? 0) + 1,
    }));
  }, []);

  const handleSpawnClick = useCallback(() => {
    const spawn = worldData.worldData?.spawn;
    if (!spawn) return;
    setFlyToRequest((prev) => ({ pos: spawn, key: (prev?.key ?? 0) + 1 }));
  }, [worldData.worldData?.spawn]);

  const handleShareStateChange = useCallback((state: ShareLocationState) => {
    shareLocationRef.current = state;
    setCurrentZoom(state.zoom);
  }, []);

  const handleChunkStatsChange = useCallback((stats: ChunkStats) => {
    setChunkStats(stats);
  }, []);

  const handleLoadingBreakdownChange = useCallback(
    (nextLoadingBreakdown: LoadingBreakdown) => {
      setLoadingBreakdown(nextLoadingBreakdown);
    },
    [],
  );

  const handleShareLocation = useCallback(async () => {
    const state = shareLocationRef.current;
    if (!state) return;

    const p = new URLSearchParams();
    p.set("mode", state.mode);
    p.set("x", String(state.pos[0]));
    p.set("y", String(state.pos[1]));
    p.set("z", String(state.pos[2]));
    p.set("zoom", String(state.zoom));
    p.set("theta", String(state.theta));
    p.set("phi", String(state.phi));

    const url = `${window.location.origin}${window.location.pathname}?${p.toString()}`;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const input = document.createElement("textarea");
        input.value = url;
        input.setAttribute("readonly", "true");
        input.style.position = "fixed";
        input.style.left = "-9999px";
        document.body.appendChild(input);
        input.select();
        const copied = document.execCommand("copy");
        document.body.removeChild(input);
        if (!copied) throw new Error("copy command failed");
      }
      setShareCopied(true);
    } catch {
      setShareCopied(false);
    }
  }, []);

  useEffect(() => {
    if (!shareCopied) return;
    const timer = window.setTimeout(() => {
      setShareCopied(false);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [shareCopied]);

  const [layerVisibility, setLayerVisibility] = useState<LayerVisibility>(
    () => ({
      biomeLabels: initialMode === "terrain",
      players: true,
      spawn: true,
      debug: false,
      chunkBorders:
        restoredGraphicsSettings?.parameterVisibility.chunkBorders ?? false,
      showTerrain: true,
      showVoxelTerrain: false,
      voxelHeightLabels:
        restoredGraphicsSettings?.parameterVisibility.voxelHeightLabels ??
        false,
    }),
  );
  const [voxelLod1MaxDist, setVoxelLod1MaxDist] = useState(
    () => restoredGraphicsSettings?.voxelLod1MaxDist ?? 600,
  );
  const [renderDistance, setRenderDistance] = useState(
    () =>
      restoredGraphicsSettings?.renderDistance ?? DEFAULT_VOXEL_RENDER_DISTANCE,
  );
  const [minRenderedVoxelLod, setMinRenderedVoxelLod] = useState(
    () =>
      restoredGraphicsSettings?.minRenderedVoxelLod ??
      DEFAULT_MIN_RENDERED_VOXEL_LOD,
  );
  const applyGraphicsPreset = useCallback((preset: GraphicsPreset) => {
    setRenderDistance(preset.renderDistance);
    setMinRenderedVoxelLod(preset.minRenderedVoxelLod);
    if (preset.minRenderedVoxelLod === 1) {
      setVoxelLod1MaxDist(preset.voxelLod1MaxDist);
    }
    setMapDebugSettings((prev) => ({
      ...prev,
      ...preset.debugSettings,
    }));
  }, []);

  const activeGraphicsPresetId = useMemo(() => {
    return (
      GRAPHICS_PRESETS.find((preset) =>
        matchesGraphicsPreset({
          preset,
          renderDistance,
          voxelLod1MaxDist,
          minRenderedVoxelLod,
          debugSettings: mapDebugSettings,
        }),
      )?.id ?? null
    );
  }, [renderDistance, voxelLod1MaxDist, minRenderedVoxelLod, mapDebugSettings]);

  useEffect(() => {
    writeStoredGraphicsSettings({
      renderDistance,
      voxelLod1MaxDist,
      minRenderedVoxelLod,
      mapDebugSettings,
      parameterVisibility: {
        chunkBorders: layerVisibility.chunkBorders,
        voxelHeightLabels: layerVisibility.voxelHeightLabels,
      },
    });
  }, [
    renderDistance,
    voxelLod1MaxDist,
    minRenderedVoxelLod,
    mapDebugSettings,
    layerVisibility.chunkBorders,
    layerVisibility.voxelHeightLabels,
  ]);

  const handleLayerVisibilityChange = useCallback((next: LayerVisibility) => {
    const normalized = next.debug
      ? next
      : {
          ...next,
          chunkBorders: false,
          voxelHeightLabels: false,
        };
    setLayerVisibility(normalized);
    if (!normalized.debug) {
      setChunkStats(createEmptyChunkStats(viewRef.current));
    }
    biomeLabelsByModeRef.current[viewRef.current] = normalized.biomeLabels;
  }, []);

  useEffect(() => {
    if (layerVisibility.debug) return;
    setChunkStats(createEmptyChunkStats(view));
  }, [layerVisibility.debug, view]);

  const { lastUpdateAt, subscribe } = useWebSocket();
  const players = usePlayers(subscribe);

  // Wire up WebSocket events to refresh data
  useEffect(() => {
    const unsubs: (() => void)[] = [];

    unsubs.push(
      subscribe("world-updated", () => {
        worldData.refresh();
      }),
    );

    unsubs.push(
      subscribe("surface-index-changed", () => {
        worldData.refreshSurfaceIndex();
        if (chunkIndexEnabled) {
          worldData.refreshChunkIndex();
        }
      }),
    );

    unsubs.push(
      subscribe("terrain-updates-batch", (event) => {
        const batch = event as TerrainUpdatesBatchEvent;
        if (batch.data.tiles.length > 0) {
          worldData.refreshSurfaceIndex();
        }
        if (batch.data.regions.length > 0) {
          if (chunkIndexEnabled) {
            worldData.refreshChunkIndex();
          }
        }
      }),
    );

    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [
    subscribe,
    worldData.refresh,
    worldData.refreshSurfaceIndex,
    worldData.refreshChunkIndex,
    chunkIndexEnabled,
  ]);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <World3DView
        worldData={worldData}
        players={players.data}
        subscribe={subscribe}
        showPlayers={layerVisibility.players}
        showSpawn={layerVisibility.spawn}
        showChunkBorders={layerVisibility.chunkBorders}
        showTerrain={layerVisibility.showTerrain}
        showVoxelTerrain={layerVisibility.showVoxelTerrain}
        showVoxelHeightLabels={layerVisibility.voxelHeightLabels}
        showBiomeLabels={layerVisibility.biomeLabels}
        renderDistance={renderDistance}
        voxelLod1MaxDist={voxelLod1MaxDist}
        minRenderedVoxelLod={minRenderedVoxelLod}
        debugEnabled={layerVisibility.debug}
        debugSettings={mapDebugSettings}
        mode={view}
        onCursorMove={handleCursorMove}
        onPlayerClick={handlePlayerClick}
        onChunkStatsChange={handleChunkStatsChange}
        onLoadingBreakdownChange={handleLoadingBreakdownChange}
        onShareStateChange={handleShareStateChange}
        initialCameraState={initialCameraState}
        flyToRequest={flyToRequest}
      />

      <TopRightToolbar
        shareCopied={shareCopied}
        onShareLocation={handleShareLocation}
        view={view}
        onViewChange={handleViewChange}
        compact={isCompactViewport}
      />

      <LoadingIndicator
        visible={isLoadingBreakdownActive(loadingBreakdown)}
        compact={isCompactViewport}
      />

      {layerVisibility.debug && !isCompactViewport && (
        <>
          <DebugStatsPanel chunkStats={chunkStats} />
          <DebugParametersPanel
            view={view}
            mapDebugSettings={mapDebugSettings}
            setMapDebugSettings={setMapDebugSettings}
            renderDistance={renderDistance}
            setRenderDistance={setRenderDistance}
            voxelLod1MaxDist={voxelLod1MaxDist}
            setVoxelLod1MaxDist={setVoxelLod1MaxDist}
            minRenderedVoxelLod={minRenderedVoxelLod}
            setMinRenderedVoxelLod={setMinRenderedVoxelLod}
            layerVisibility={layerVisibility}
            setLayerVisibility={setLayerVisibility}
          />
        </>
      )}

      {/* Always mounted; shown/hidden via style.display to avoid re-renders on mouse move */}
      <div
        ref={cursorHudRef}
        style={{
          display: "none",
          position: "absolute",
          top: isCompactViewport ? 54 : 12,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 1000,
          background: uiTheme.panel.background,
          border: `2px solid ${uiTheme.panel.border}`,
          borderRadius: 0,
          padding: "5px 14px",
          fontSize: 12,
          color: uiTheme.text.secondary,
          pointerEvents: "none",
          whiteSpace: "nowrap",
          boxShadow: uiTheme.panel.shadow,
          backdropFilter: "blur(5px)",
        }}
      />

      {isCompactViewport ? (
        <MobileHudTray
          showDebugTab={layerVisibility.debug}
          controlsContent={
            <MapControlsContent
              view={view}
              activeGraphicsPresetId={activeGraphicsPresetId}
              applyGraphicsPreset={applyGraphicsPreset}
              layerVisibility={layerVisibility}
              handleLayerVisibilityChange={handleLayerVisibilityChange}
              compact={true}
            />
          }
          worldContent={
            <InfoPanelContent
              worldData={worldData}
              players={players.data}
              lastUpdateAt={lastUpdateAt}
              zoomLevel={currentZoom}
              onPlayerClick={handlePlayerClick}
              onSpawnClick={handleSpawnClick}
              compact={true}
            />
          }
          debugContent={
            <>
              <DebugStatsContent chunkStats={chunkStats} />
              <DebugParametersContent
                view={view}
                mapDebugSettings={mapDebugSettings}
                setMapDebugSettings={setMapDebugSettings}
                renderDistance={renderDistance}
                setRenderDistance={setRenderDistance}
                voxelLod1MaxDist={voxelLod1MaxDist}
                setVoxelLod1MaxDist={setVoxelLod1MaxDist}
                minRenderedVoxelLod={minRenderedVoxelLod}
                setMinRenderedVoxelLod={setMinRenderedVoxelLod}
                layerVisibility={layerVisibility}
                setLayerVisibility={setLayerVisibility}
              />
            </>
          }
        />
      ) : (
        <MapControlsPanel
          view={view}
          activeGraphicsPresetId={activeGraphicsPresetId}
          applyGraphicsPreset={applyGraphicsPreset}
          layerVisibility={layerVisibility}
          handleLayerVisibilityChange={handleLayerVisibilityChange}
        />
      )}

      <style>{`@keyframes cubyz-half-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {!isCompactViewport && (
        <InfoPanel
          worldData={worldData}
          players={players.data}
          lastUpdateAt={lastUpdateAt}
          zoomLevel={currentZoom}
          onPlayerClick={handlePlayerClick}
          onSpawnClick={handleSpawnClick}
        />
      )}
    </div>
  );
}
