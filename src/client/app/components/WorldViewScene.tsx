import {
  useWorldControlsActions,
  useWorldControlsState,
} from "../../features/world-controls/WorldControlsProvider.js";
import { World3DView } from "../../features/world-view/components/World3DView.js";
import type { PlayerData } from "../../features/world-view/hooks/usePlayers.js";
import type { useWebSocket } from "../../features/world-view/hooks/useWebSocket.js";
import type { useWorldData } from "../../features/world-view/hooks/useWorldData.js";
import type { CursorHoverInfo } from "../../features/world-view/lib/types.js";
import type {
  InitialCameraState,
  ShareLocationState,
} from "../../types/world-view.js";

export function WorldViewScene({
  initialCameraState,
  players,
  subscribe,
  worldData,
  onCursorMove,
  onPlayerClick,
  onShareStateChange,
}: {
  initialCameraState: InitialCameraState | null;
  players: PlayerData[];
  subscribe: ReturnType<typeof useWebSocket>["subscribe"];
  worldData: ReturnType<typeof useWorldData>;
  onCursorMove: (info: CursorHoverInfo | null) => void;
  onPlayerClick: (player: PlayerData) => void;
  onShareStateChange: (state: ShareLocationState) => void;
}) {
  const state = useWorldControlsState();
  const { setChunkStats, setLoadingBreakdown } = useWorldControlsActions();

  return (
    <World3DView
      worldData={worldData}
      players={players}
      subscribe={subscribe}
      showPlayers={state.layerVisibility.players}
      showSpawn={state.layerVisibility.spawn}
      showChunkBorders={state.layerVisibility.chunkBorders}
      showTerrainUnderlay={state.layerVisibility.showTerrainUnderlay}
      showVoxelHeightLabels={state.layerVisibility.voxelHeightLabels}
      showBiomeLabels={state.layerVisibility.biomeLabels}
      renderDistance={state.renderDistance}
      voxelLod1MaxDist={state.voxelLod1MaxDist}
      minRenderedVoxelLod={state.minRenderedVoxelLod}
      debugEnabled={state.layerVisibility.debug}
      debugSettings={state.mapDebugSettings}
      onCursorMove={onCursorMove}
      onPlayerClick={onPlayerClick}
      onChunkStatsChange={setChunkStats}
      onLoadingBreakdownChange={setLoadingBreakdown}
      onShareStateChange={onShareStateChange}
      initialCameraState={initialCameraState}
      flyToRequest={state.flyToRequest}
    />
  );
}
