import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InfoPanel } from "../features/world-view/components/InfoPanel.js";
import {
  LayerControls,
  type LayerVisibility,
} from "../features/world-view/components/LayerControls.js";
import { MapDebugParameters } from "../features/world-view/components/MapDebugParameters.js";
import { ViewToggle } from "../features/world-view/components/ViewToggle.js";
import {
  type InitialCameraState,
  World3DView,
} from "../features/world-view/components/World3DView.js";
import {
  type ChunkStats,
  createEmptyChunkStats,
  DEFAULT_MAP_DEBUG_SETTINGS,
  type MapDebugSettings,
} from "../features/world-view/debug.js";
import type { PlayerData } from "../features/world-view/hooks/usePlayers.js";
import { usePlayers } from "../features/world-view/hooks/usePlayers.js";
import { useWebSocket } from "../features/world-view/hooks/useWebSocket.js";
import { useWorldData } from "../features/world-view/hooks/useWorldData.js";
import {
  GRAPHICS_PRESETS,
  type GraphicsPreset,
  matchesGraphicsPreset,
} from "../features/world-view/lib/graphics-presets.js";
import { OverlayPanel } from "../shared/ui/OverlayPanel.js";
import { uiTheme } from "../shared/ui/theme.js";

type ShareLocationState =
  | {
      mode: "terrain";
      pos: [number, number, number];
      zoom: number;
      theta: number;
      phi: number;
    }
  | {
      mode: "voxel";
      pos: [number, number, number];
      zoom: number;
      theta: number;
      phi: number;
    };

const DEFAULT_VOXEL_RENDER_DISTANCE = 19200;
const DEFAULT_MIN_RENDERED_VOXEL_LOD = 1;

function formatMemoryBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function LoadingIndicator({ visible }: { visible: boolean }) {
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
        right: 12,
        bottom: 12,
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

export function App() {
  // Parse URL params once on mount — lazy initializer so it never re-runs.
  const initialMode = useMemo<"terrain" | "voxel">(() => {
    const p = new URLSearchParams(window.location.search);
    return p.get("mode") === "voxel" ? "voxel" : "terrain";
  }, []);

  const initialCameraState = useMemo<InitialCameraState | null>(() => {
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
    // Partial URL (x/y/z only, no camera angles) — not enough to restore full state.
    return null;
  }, []);

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
  const [chunkIndexEnabled, setChunkIndexEnabled] = useState(
    initialMode === "voxel",
  );
  const [mapDebugSettings, setMapDebugSettings] = useState<MapDebugSettings>(
    DEFAULT_MAP_DEBUG_SETTINGS,
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

  const [layerVisibility, setLayerVisibility] = useState<LayerVisibility>({
    biomeLabels: initialMode === "terrain",
    players: true,
    spawn: true,
    debug: false,
    chunkBorders: false,
    showTerrain: true,
    showVoxelTerrain: false,
    voxelHeightLabels: false,
  });
  const [voxelLod1MaxDist, setVoxelLod1MaxDist] = useState(600);
  const [renderDistance, setRenderDistance] = useState(
    DEFAULT_VOXEL_RENDER_DISTANCE,
  );
  const [minRenderedVoxelLod, setMinRenderedVoxelLod] = useState(
    DEFAULT_MIN_RENDERED_VOXEL_LOD,
  );
  const [voxelLoading, setVoxelLoading] = useState(false);

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
        if (event.type !== "terrain-updates-batch") return;
        if (event.data.tiles.length > 0) {
          worldData.refreshSurfaceIndex();
        }
        if (event.data.regions.length > 0) {
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
        onVoxelLoadingChange={setVoxelLoading}
        onShareStateChange={handleShareStateChange}
        initialCameraState={initialCameraState}
        flyToRequest={flyToRequest}
      />

      <div
        style={{
          position: "absolute",
          top: 12,
          right: 12,
          zIndex: 1000,
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 10,
        }}
      >
        <button
          type="button"
          onClick={handleShareLocation}
          style={{
            padding: "8px 14px",
            border: "none",
            borderRadius: 6,
            background: shareCopied
              ? uiTheme.accent.surfaceActive
              : uiTheme.panel.buttonBackgroundMuted,
            color: shareCopied ? uiTheme.text.onAccent : uiTheme.text.muted,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            transition: "all 0.2s",
          }}
        >
          {shareCopied ? "Copied" : "Copy Location"}
        </button>
        <ViewToggle view={view} onViewChange={handleViewChange} />
      </div>

      <LoadingIndicator
        visible={layerVisibility.debug ? false : voxelLoading}
      />

      {layerVisibility.debug && (
        <>
          <OverlayPanel
            title="Stats"
            position={{ top: 54, right: 12 }}
            minWidth={280}
            maxWidth={360}
            collapsible={true}
            defaultCollapsed={true}
            contentStyle={{
              fontSize: 12,
              lineHeight: 1.55,
              color: uiTheme.text.secondary,
            }}
          >
            <div style={{ display: "grid", gap: 6 }}>
              <div>
                Mode: {chunkStats.mode === "terrain" ? "Terrain" : "Voxel"}
              </div>
              <div>Focus LOD: {chunkStats.focusLod}</div>
              <div>FPS: {chunkStats.fps}</div>
              <div>Loading chunks: {chunkStats.loading}</div>
              <div>Loaded chunks: {chunkStats.loaded}</div>

              <div
                style={{
                  marginTop: 4,
                  color: uiTheme.accent.text,
                  fontWeight: 700,
                }}
              >
                Loading breakdown
              </div>
              <div>Terrain loading: {chunkStats.loadingBreakdown.terrain}</div>
              <div>Voxel loading: {chunkStats.loadingBreakdown.voxels}</div>
              <div>Fetch queue: {chunkStats.loadingBreakdown.fetchQueue}</div>
              <div>Mesh queue: {chunkStats.loadingBreakdown.meshQueue}</div>

              <div
                style={{
                  marginTop: 4,
                  color: uiTheme.accent.text,
                  fontWeight: 700,
                }}
              >
                Voxel health
              </div>
              <div>Missing regions: {chunkStats.voxelHealth.missing}</div>
              <div>Failed regions: {chunkStats.voxelHealth.failed}</div>

              <div
                style={{
                  marginTop: 4,
                  color: uiTheme.accent.text,
                  fontWeight: 700,
                }}
              >
                Loaded by LOD
              </div>
              <div>
                {([1, 2, 4, 8, 16, 32] as const)
                  .map((lod) => `L${lod}:${chunkStats.loadedByLod[lod] ?? 0}`)
                  .join("  ")}
              </div>

              <div
                style={{
                  marginTop: 4,
                  color: uiTheme.accent.text,
                  fontWeight: 700,
                }}
              >
                Estimated Memory
              </div>
              <div>Total: {formatMemoryBytes(chunkStats.memoryBytes)}</div>
              <div>
                Terrain: {formatMemoryBytes(chunkStats.memoryBreakdown.terrain)}
              </div>
              <div>
                Voxels: {formatMemoryBytes(chunkStats.memoryBreakdown.voxels)}
              </div>
              <div>
                Warm cache:{" "}
                {formatMemoryBytes(chunkStats.memoryBreakdown.cached)} (
                {chunkStats.warmCacheCount})
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

              <div
                style={{
                  marginTop: 4,
                  color: uiTheme.accent.text,
                  fontWeight: 700,
                }}
              >
                Memory by LOD
              </div>
              <div>
                {([1, 2, 4, 8, 16, 32] as const)
                  .map(
                    (lod) =>
                      `L${lod}:${formatMemoryBytes(chunkStats.memoryByLod[lod] ?? 0)}`,
                  )
                  .join("  ")}
              </div>
            </div>
          </OverlayPanel>

          <OverlayPanel
            title="Parameters"
            position={{ top: 108, right: 12 }}
            minWidth={280}
            maxWidth={360}
            collapsible={true}
            defaultCollapsed={true}
            contentStyle={{
              fontSize: 12,
              lineHeight: 1.55,
              color: uiTheme.text.secondary,
            }}
          >
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
          </OverlayPanel>
        </>
      )}

      {/* Always mounted; shown/hidden via style.display to avoid re-renders on mouse move */}
      <div
        ref={cursorHudRef}
        style={{
          display: "none",
          position: "absolute",
          top: 12,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 1000,
          background: uiTheme.panel.background,
          border: `1px solid ${uiTheme.panel.border}`,
          borderRadius: 6,
          padding: "5px 14px",
          fontSize: 12,
          color: uiTheme.text.secondary,
          pointerEvents: "none",
          whiteSpace: "nowrap",
          boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
          backdropFilter: "blur(8px)",
        }}
      />

      <OverlayPanel
        title="Map Controls"
        position={{ top: 12, left: 12 }}
        minWidth={250}
        maxWidth={350}
        collapsible={true}
        contentStyle={{ fontSize: 12, lineHeight: 1.55 }}
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
                <span style={{ color: uiTheme.accent.text, fontWeight: 700 }}>
                  Graphics Presets
                </span>
                <span style={{ color: uiTheme.text.muted, fontSize: 11 }}>
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
                        padding: "8px 10px",
                        borderRadius: 6,
                        border: active
                          ? `1px solid ${uiTheme.accent.border}`
                          : `1px solid ${uiTheme.panel.buttonBorderMuted}`,
                        background: active
                          ? uiTheme.accent.surfaceActive
                          : uiTheme.panel.buttonBackgroundMuted,
                        color: active
                          ? uiTheme.text.onAccent
                          : uiTheme.text.secondary,
                        cursor: "pointer",
                        fontSize: 11,
                        fontWeight: 700,
                        textAlign: "center",
                      }}
                    >
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
              lineHeight: 1.55,
              color: uiTheme.text.secondary,
              display: "grid",
              gap: 8,
            }}
          >
            <div>
              <div
                style={{
                  color: uiTheme.accent.text,
                  fontWeight: 700,
                  marginBottom: 2,
                }}
              >
                Mouse
              </div>
              <div>Left drag: pan</div>
              <div>Right drag: orbit</div>
              <div>Wheel / middle drag: zoom</div>
            </div>
            <div>
              <div
                style={{
                  color: uiTheme.accent.text,
                  fontWeight: 700,
                  marginBottom: 2,
                }}
              >
                Keyboard
              </div>
              <div>W/A/S/D or arrows: move camera target</div>
              <div>Q / E: rotate around center</div>
              <div>Space: focus spawn</div>
            </div>
          </div>
        </div>
      </OverlayPanel>

      <style>{`@keyframes cubyz-half-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      <InfoPanel
        worldData={worldData}
        players={players.data}
        lastUpdateAt={lastUpdateAt}
        zoomLevel={currentZoom}
        onPlayerClick={handlePlayerClick}
        onSpawnClick={handleSpawnClick}
      />
    </div>
  );
}
