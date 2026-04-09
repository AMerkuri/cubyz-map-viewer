import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Map3D, type InitialCameraState } from "./components/Map3D.js";
import { ViewToggle } from "./components/ViewToggle.js";
import { LayerControls, type LayerVisibility } from "./components/LayerControls.js";
import { InfoPanel } from "./components/InfoPanel.js";
import { OverlayPanel } from "./components/OverlayPanel.js";
import { useWorldData } from "./hooks/useWorldData.js";
import { usePlayers } from "./hooks/usePlayers.js";
import { useWebSocket } from "./hooks/useWebSocket.js";
import type { PlayerData } from "./hooks/usePlayers.js";

type ShareLocationState =
  | { mode: "terrain"; pos: [number, number, number]; zoom: number; theta: number; phi: number }
  | { mode: "voxel"; pos: [number, number, number]; zoom: number; theta: number; phi: number };

type ChunkStats = {
  loading: number;
  loaded: number;
  fps: number;
  focusLod: number;
  mode: "terrain" | "voxel";
  loadingBreakdown: {
    terrain: number;
    voxels: number;
    fetchQueue: number;
    meshQueue: number;
  };
  voxelHealth: {
    missing: number;
    failed: number;
  };
  loadedByLod: Partial<Record<1 | 2 | 4 | 8 | 16 | 32, number>>;
  memoryBytes: number;
  memoryBreakdown: {
    terrain: number;
    voxels: number;
    cached: number;
    queued: number;
  };
  memoryByLod: Partial<Record<1 | 2 | 4 | 8 | 16 | 32, number>>;
  jsHeapBytes: number | null;
  warmCacheCount: number;
};

function formatMemoryBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
    if (!isNaN(x) && !isNaN(y) && !isNaN(z) && !isNaN(zoom) && !isNaN(theta) && !isNaN(phi)) {
      return { pos: [x, y, z], zoom, theta, phi };
    }
    // Partial URL (x/y/z only, no camera angles) — not enough to restore full state.
    return null;
  }, []);

  const [view, setView] = useState<"terrain" | "voxel">(initialMode);
  const [flyToRequest, setFlyToRequest] = useState<{ pos: [number, number, number]; key: number } | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [currentZoom, setCurrentZoom] = useState<number | null>(null);
  const [chunkStats, setChunkStats] = useState<ChunkStats>({
    loading: 0,
    loaded: 0,
    fps: 0,
    focusLod: 1,
    mode: initialMode,
    loadingBreakdown: {
      terrain: 0,
      voxels: 0,
      fetchQueue: 0,
      meshQueue: 0,
    },
    voxelHealth: {
      missing: 0,
      failed: 0,
    },
    loadedByLod: {},
    memoryBytes: 0,
    memoryBreakdown: {
      terrain: 0,
      voxels: 0,
      cached: 0,
      queued: 0,
    },
    memoryByLod: {},
    jsHeapBytes: null,
    warmCacheCount: 0,
  });
  const worldData = useWorldData();

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
  const handleCursorMove = useCallback((pos: [number, number, number] | null) => {
    const el = cursorHudRef.current;
    if (!el) return;
    if (!pos) {
      el.style.display = "none";
      return;
    }
    el.style.display = "";
    el.textContent = `X ${pos[0]}  Y ${pos[1]}  Z ${pos[2]}`;
  }, []);

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
    setView(next);
  }, []);

  const handlePlayerClick = useCallback((player: PlayerData) => {
    setFlyToRequest((prev) => ({ pos: player.position, key: (prev?.key ?? 0) + 1 }));
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
    chunkBorders: false,
    showTerrain: true,
    showVoxelTerrain: false,
    voxelHeightLabels: false,
  });
  const [voxelLod1MaxDist, setVoxelLod1MaxDist] = useState(600);

  const handleLayerVisibilityChange = useCallback((next: LayerVisibility) => {
    setLayerVisibility(next);
    biomeLabelsByModeRef.current[viewRef.current] = next.biomeLabels;
  }, []);

  const players = usePlayers();
  const { lastUpdateAt, subscribe } = useWebSocket();

  const updateAge = useMemo(() => {
    if (lastUpdateAt === null) return "-";
    const deltaMs = Date.now() - lastUpdateAt;
    if (deltaMs < 1000) return `${deltaMs} ms ago`;
    return `${(deltaMs / 1000).toFixed(1)} s ago`;
  }, [lastUpdateAt]);

  // Wire up WebSocket events to refresh data
  useEffect(() => {
    const unsubs: (() => void)[] = [];

    unsubs.push(
      subscribe("players-updated", () => {
        players.refresh();
      })
    );

    unsubs.push(
      subscribe("world-updated", () => {
        worldData.refresh();
      })
    );

    unsubs.push(
      subscribe("surface-index-changed", () => {
        worldData.refreshSurfaceIndex();
        worldData.refreshChunkIndex();
      })
    );

    unsubs.push(
      subscribe("terrain-updates-batch", (event) => {
        if (event.type !== "terrain-updates-batch") return;
        if (event.data.tiles.length > 0) {
          worldData.refreshSurfaceIndex();
        }
        if (event.data.regions.length > 0) {
          worldData.refreshChunkIndex();
        }
      })
    );

    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [subscribe, players.refresh, worldData.refresh, worldData.refreshSurfaceIndex, worldData.refreshChunkIndex]);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <Map3D
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
        voxelLod1MaxDist={voxelLod1MaxDist}
        mode={view}
        onCursorMove={handleCursorMove}
        onChunkStatsChange={handleChunkStatsChange}
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
          gap: 10,
        }}
      >
        <button
          onClick={handleShareLocation}
          style={{
            padding: "8px 14px",
            border: "none",
            borderRadius: 6,
            background: shareCopied ? "#4a90d9" : "#2a2a3e",
            color: shareCopied ? "#fff" : "#aaa",
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

      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          zIndex: 1000,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <OverlayPanel
          title="Controls"
          absolute={false}
          minWidth={250}
          maxWidth={350}
          collapsible={true}
        >
          <div style={{ fontSize: 12, lineHeight: 1.55, color: "#d6d9ea", display: "grid", gap: 8 }}>
            <div>
              <div style={{ color: "#8fa4e8", fontWeight: 700, marginBottom: 2 }}>Mouse</div>
              <div>Left drag: pan</div>
              <div>Right drag: orbit</div>
              <div>Wheel / middle drag: zoom</div>
            </div>
            <div>
              <div style={{ color: "#8fa4e8", fontWeight: 700, marginBottom: 2 }}>Keyboard</div>
              <div>W/A/S/D or arrows: move camera target</div>
              <div>Q / E: rotate around center</div>
              <div>Space: focus spawn</div>
            </div>
          </div>
        </OverlayPanel>

        <OverlayPanel
          title="Map Stats"
          absolute={false}
          minWidth={250}
          maxWidth={350}
          collapsible={true}
          defaultCollapsed={true}
          contentStyle={{ fontSize: 12, lineHeight: 1.55, color: "#d6d9ea" }}
        >
          <div style={{ display: "grid", gap: 6 }}>
            <div>Mode: {chunkStats.mode === "terrain" ? "Terrain" : "Voxel"}</div>
            <div>Focus LOD: {chunkStats.focusLod}</div>
            <div>FPS: {chunkStats.fps}</div>
            <div>WS age: {updateAge}</div>
            <div>Loading chunks: {chunkStats.loading}</div>
            <div>Loaded chunks: {chunkStats.loaded}</div>

            <div style={{ marginTop: 4, color: "#8fa4e8", fontWeight: 700 }}>Loading breakdown</div>
            <div>Terrain loading: {chunkStats.loadingBreakdown.terrain}</div>
            <div>Voxel loading: {chunkStats.loadingBreakdown.voxels}</div>
            <div>Fetch queue: {chunkStats.loadingBreakdown.fetchQueue}</div>
            <div>Mesh queue: {chunkStats.loadingBreakdown.meshQueue}</div>

            <div style={{ marginTop: 4, color: "#8fa4e8", fontWeight: 700 }}>Voxel health</div>
            <div>Missing regions: {chunkStats.voxelHealth.missing}</div>
            <div>Failed regions: {chunkStats.voxelHealth.failed}</div>

            <div style={{ marginTop: 4, color: "#8fa4e8", fontWeight: 700 }}>Loaded by LOD</div>
            <div>
              {([1, 2, 4, 8, 16, 32] as const)
                .map((lod) => `L${lod}:${chunkStats.loadedByLod[lod] ?? 0}`)
                .join("  ")}
            </div>

            <div style={{ marginTop: 4, color: "#8fa4e8", fontWeight: 700 }}>Estimated Memory</div>
            <div>Total: {formatMemoryBytes(chunkStats.memoryBytes)}</div>
            <div>Terrain: {formatMemoryBytes(chunkStats.memoryBreakdown.terrain)}</div>
            <div>Voxels: {formatMemoryBytes(chunkStats.memoryBreakdown.voxels)}</div>
            <div>Warm cache: {formatMemoryBytes(chunkStats.memoryBreakdown.cached)} ({chunkStats.warmCacheCount})</div>
            <div>Queued: {formatMemoryBytes(chunkStats.memoryBreakdown.queued)}</div>
            <div>JS heap: {chunkStats.jsHeapBytes === null ? "n/a" : formatMemoryBytes(chunkStats.jsHeapBytes)}</div>

            <div style={{ marginTop: 4, color: "#8fa4e8", fontWeight: 700 }}>Memory by LOD</div>
            <div>
              {([1, 2, 4, 8, 16, 32] as const)
                .map((lod) => `L${lod}:${formatMemoryBytes(chunkStats.memoryByLod[lod] ?? 0)}`)
                .join("  ")}
            </div>
          </div>
        </OverlayPanel>
      </div>

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
          background: "rgba(26, 26, 46, 0.88)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 6,
          padding: "5px 14px",
          fontSize: 12,
          color: "#ddd",
          pointerEvents: "none",
          whiteSpace: "nowrap",
          boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
          backdropFilter: "blur(8px)",
        }}
      />

      <OverlayPanel
        title="Map Controls"
        position={{ right: 12, bottom: 12 }}
        minWidth={180}
        collapsible={true}
        contentStyle={{ fontSize: 12, lineHeight: 1.55 }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <LayerControls
            visibility={layerVisibility}
            onChange={handleLayerVisibilityChange}
            view={view}
            voxelLod1MaxDist={voxelLod1MaxDist}
            onVoxelLod1MaxDistChange={setVoxelLod1MaxDist}
          />
        </div>
      </OverlayPanel>

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
