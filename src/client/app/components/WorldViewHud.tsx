import { DebugParametersContent } from "../../features/world-controls/components/DebugParametersContent.js";
import { DebugParametersPanel } from "../../features/world-controls/components/DebugParametersPanel.js";
import { DebugStatsContent } from "../../features/world-controls/components/DebugStatsContent.js";
import { DebugStatsPanel } from "../../features/world-controls/components/DebugStatsPanel.js";
import { LoadingIndicator } from "../../features/world-controls/components/LoadingIndicator.js";
import { MapControlsContent } from "../../features/world-controls/components/MapControlsContent.js";
import { MapControlsPanel } from "../../features/world-controls/components/MapControlsPanel.js";
import { MobileHudTray } from "../../features/world-controls/components/MobileHudTray.js";
import { TopRightToolbar } from "../../features/world-controls/components/TopRightToolbar.js";
import {
  useWorldControls,
  useWorldControlsActions,
} from "../../features/world-controls/WorldControlsProvider.js";
import {
  InfoPanel,
  InfoPanelContent,
} from "../../features/world-view/components/InfoPanel.js";
import type { PlayerData } from "../../features/world-view/hooks/usePlayers.js";
import type { useWorldData } from "../../features/world-view/hooks/useWorldData.js";
import { isLoadingBreakdownActive } from "../../utils/world-view-formatters.js";
import { CursorHud } from "./CursorHud.js";

export function WorldViewHud({
  compact,
  currentZoom,
  cursorHudRef,
  lastUpdateAt,
  onPlayerClick,
  onShareLocation,
  onSpawnClick,
  players,
  shareCopied,
  worldData,
}: {
  compact: boolean;
  currentZoom: number | null;
  cursorHudRef: React.RefObject<HTMLDivElement | null>;
  lastUpdateAt: number | null;
  onPlayerClick: (player: PlayerData) => void;
  onShareLocation: () => void;
  onSpawnClick: () => void;
  players: PlayerData[];
  shareCopied: boolean;
  worldData: ReturnType<typeof useWorldData>;
}) {
  const { state, activeGraphicsPresetId, applyGraphicsPreset } =
    useWorldControls();
  const {
    setChunkBorders,
    setVoxelHeightLabels,
    updateLayerVisibility,
    updateMapDebugSettings,
    updateMinRenderedVoxelLod,
    updateRenderDistance,
    updateVoxelLod1MaxDist,
  } = useWorldControlsActions();

  return (
    <>
      <TopRightToolbar
        shareCopied={shareCopied}
        onShareLocation={onShareLocation}
        compact={compact}
      />

      <LoadingIndicator
        visible={isLoadingBreakdownActive(state.loadingBreakdown)}
        loadingChunks={state.chunkStats.loading}
        loadedChunks={state.chunkStats.loaded}
        compact={compact}
      />

      {state.layerVisibility.debug && !compact && (
        <>
          <DebugStatsPanel chunkStats={state.chunkStats} />
          <DebugParametersPanel
            view={state.view}
            mapDebugSettings={state.mapDebugSettings}
            setMapDebugSettings={updateMapDebugSettings}
            renderDistance={state.renderDistance}
            setRenderDistance={updateRenderDistance}
            voxelLod1MaxDist={state.voxelLod1MaxDist}
            setVoxelLod1MaxDist={updateVoxelLod1MaxDist}
            minRenderedVoxelLod={state.minRenderedVoxelLod}
            setMinRenderedVoxelLod={updateMinRenderedVoxelLod}
            layerVisibility={state.layerVisibility}
            setChunkBorders={setChunkBorders}
            setVoxelHeightLabels={setVoxelHeightLabels}
          />
        </>
      )}

      <CursorHud cursorHudRef={cursorHudRef} compact={compact} />

      {compact ? (
        <MobileHudTray
          showDebugTab={state.layerVisibility.debug}
          controlsContent={
            <MapControlsContent
              view={state.view}
              activeGraphicsPresetId={activeGraphicsPresetId}
              applyGraphicsPreset={applyGraphicsPreset}
              layerVisibility={state.layerVisibility}
              handleLayerVisibilityChange={updateLayerVisibility}
              compact={true}
            />
          }
          worldContent={
            <InfoPanelContent
              worldData={worldData}
              players={players}
              lastUpdateAt={lastUpdateAt}
              zoomLevel={currentZoom}
              onPlayerClick={onPlayerClick}
              onSpawnClick={onSpawnClick}
              compact={true}
            />
          }
          debugContent={
            <>
              <DebugStatsContent chunkStats={state.chunkStats} />
              <DebugParametersContent
                view={state.view}
                mapDebugSettings={state.mapDebugSettings}
                setMapDebugSettings={updateMapDebugSettings}
                renderDistance={state.renderDistance}
                setRenderDistance={updateRenderDistance}
                voxelLod1MaxDist={state.voxelLod1MaxDist}
                setVoxelLod1MaxDist={updateVoxelLod1MaxDist}
                minRenderedVoxelLod={state.minRenderedVoxelLod}
                setMinRenderedVoxelLod={updateMinRenderedVoxelLod}
                layerVisibility={state.layerVisibility}
                setChunkBorders={setChunkBorders}
                setVoxelHeightLabels={setVoxelHeightLabels}
              />
            </>
          }
        />
      ) : (
        <MapControlsPanel
          view={state.view}
          activeGraphicsPresetId={activeGraphicsPresetId}
          applyGraphicsPreset={applyGraphicsPreset}
          layerVisibility={state.layerVisibility}
          handleLayerVisibilityChange={updateLayerVisibility}
        />
      )}

      {!compact && (
        <InfoPanel
          worldData={worldData}
          players={players}
          lastUpdateAt={lastUpdateAt}
          zoomLevel={currentZoom}
          onPlayerClick={onPlayerClick}
          onSpawnClick={onSpawnClick}
        />
      )}
    </>
  );
}
