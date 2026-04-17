import {
  type Dispatch,
  lazy,
  type ReactNode,
  type SetStateAction,
  Suspense,
} from "react";
import {
  LayerControls,
  type LayerVisibility,
} from "../features/world-view/components/LayerControls.js";
import type {
  ChunkStats,
  MapDebugSettings,
} from "../features/world-view/debug.js";
import {
  GRAPHICS_PRESETS,
  type GraphicsPreset,
} from "../features/world-view/lib/graphics-presets.js";
import { uiTheme } from "../shared/ui/theme.js";

const MapDebugParameters = lazy(async () =>
  import("../features/world-view/components/MapDebugParameters.js").then(
    ({ MapDebugParameters }) => ({ default: MapDebugParameters }),
  ),
);

interface MapControlsContentProps {
  view: "terrain" | "voxel";
  activeGraphicsPresetId: string | null;
  applyGraphicsPreset: (preset: GraphicsPreset) => void;
  layerVisibility: LayerVisibility;
  handleLayerVisibilityChange: (visibility: LayerVisibility) => void;
  compact?: boolean;
}

interface DebugParametersContentProps {
  view: "terrain" | "voxel";
  mapDebugSettings: MapDebugSettings;
  setMapDebugSettings: Dispatch<SetStateAction<MapDebugSettings>>;
  renderDistance: number;
  setRenderDistance: Dispatch<SetStateAction<number>>;
  voxelLod1MaxDist: number;
  setVoxelLod1MaxDist: Dispatch<SetStateAction<number>>;
  minRenderedVoxelLod: number;
  setMinRenderedVoxelLod: Dispatch<SetStateAction<number>>;
  layerVisibility: LayerVisibility;
  setLayerVisibility: Dispatch<SetStateAction<LayerVisibility>>;
}

export function StatsSectionTitle({ children }: { children: ReactNode }) {
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

export function DebugStatsContent({ chunkStats }: { chunkStats: ChunkStats }) {
  return (
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
      <div>Voxels: {formatMemoryBytes(chunkStats.memoryBreakdown.voxels)}</div>
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
      <div>Queued: {formatMemoryBytes(chunkStats.memoryBreakdown.queued)}</div>
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
      <div>Encoding: {chunkStats.voxelBenchmark.contentEncoding ?? "n/a"}</div>
      <div>Avg fetch: {chunkStats.voxelBenchmark.avgFetchMs.toFixed(1)} ms</div>
      <div>
        Avg decode: {chunkStats.voxelBenchmark.avgDecodeMs.toFixed(1)} ms
      </div>
      <div>Avg total: {chunkStats.voxelBenchmark.avgTotalMs.toFixed(1)} ms</div>
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
  );
}

export function MapControlsContent({
  view,
  activeGraphicsPresetId,
  applyGraphicsPreset,
  layerVisibility,
  handleLayerVisibilityChange,
  compact = false,
}: MapControlsContentProps) {
  return (
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
                    padding: compact ? "9px 10px" : "8px 10px",
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
        compact={compact}
      />
      <div
        style={{
          fontSize: 12,
          lineHeight: 1.25,
          color: uiTheme.text.secondary,
          display: "grid",
          gap: 6,
        }}
      >
        <StatsSectionTitle>Touch</StatsSectionTitle>
        <div>Drag: pan</div>
        <div>Pinch: zoom</div>
        <div>Two-finger drag: orbit</div>
        <div>Tap and hold: show coordinates</div>
      </div>
    </div>
  );
}

export function DebugParametersContent({
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
}: DebugParametersContentProps) {
  return (
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
  );
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
