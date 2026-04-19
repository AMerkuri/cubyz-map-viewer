import { useCallback, useRef } from "react";
import {
  useWorldControlsActions,
  useWorldControlsState,
} from "../../features/world-controls/WorldControlsProvider.js";
import type { PlayerData } from "../../features/world-view/hooks/usePlayers.js";
import { usePlayers } from "../../features/world-view/hooks/usePlayers.js";
import { useWebSocket } from "../../features/world-view/hooks/useWebSocket.js";
import { useWorldData } from "../../features/world-view/hooks/useWorldData.js";
import type { CursorHoverInfo } from "../../features/world-view/lib/types.js";
import { useCompactViewport } from "../../hooks/useCompactViewport.js";
import type {
  InitialCameraState,
  ShareLocationState,
} from "../../types/world-view.js";
import { useWorldViewRefreshSubscriptions } from "../hooks/useWorldViewRefreshSubscriptions.js";
import { useWorldViewShareLocation } from "../hooks/useWorldViewShareLocation.js";
import { WorldViewHud } from "./WorldViewHud.js";
import { WorldViewScene } from "./WorldViewScene.js";

export function WorldViewPageContent({
  initialCameraState,
}: {
  initialCameraState: InitialCameraState | null;
}) {
  const isCompactViewport = useCompactViewport();
  const state = useWorldControlsState();
  const { flyToPosition } = useWorldControlsActions();
  const worldData = useWorldData(state.chunkIndexEnabled);
  const { lastUpdateAt, subscribe } = useWebSocket();
  const players = usePlayers(subscribe);
  const cursorHudRef = useRef<HTMLDivElement>(null);
  const {
    currentZoom,
    shareCopied,
    handleShareLocation,
    handleShareStateChange,
  } = useWorldViewShareLocation();

  useWorldViewRefreshSubscriptions({
    chunkIndexEnabled: state.chunkIndexEnabled,
    subscribe,
    worldData,
  });

  const handleCursorMove = useCallback((info: CursorHoverInfo | null) => {
    const el = cursorHudRef.current;
    if (!el) return;
    if (!info) {
      el.style.display = "none";
      return;
    }
    el.style.display = "";
    const [x, y, z] = info.pos;
    el.textContent =
      info.voxelChunkLod !== undefined
        ? `X ${x}  Y ${y}  Z ${z}  LOD ${info.voxelChunkLod} ${info.voxelRegion?.[0] ?? "?"}/${info.voxelRegion?.[1] ?? "?"}`
        : `X ${x}  Y ${y}  Z ${z}`;
  }, []);

  const handlePlayerClick = useCallback(
    (player: PlayerData) => {
      flyToPosition(player.position);
    },
    [flyToPosition],
  );

  const handleSpawnClick = useCallback(() => {
    const spawn = worldData.worldData?.spawn;
    if (!spawn) return;
    flyToPosition(spawn);
  }, [flyToPosition, worldData.worldData?.spawn]);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <WorldViewScene
        initialCameraState={initialCameraState}
        players={players.data}
        subscribe={subscribe}
        worldData={worldData}
        onCursorMove={handleCursorMove}
        onPlayerClick={handlePlayerClick}
        onShareStateChange={
          handleShareStateChange as (state: ShareLocationState) => void
        }
      />
      <WorldViewHud
        compact={isCompactViewport}
        currentZoom={currentZoom}
        cursorHudRef={cursorHudRef}
        lastUpdateAt={lastUpdateAt}
        onPlayerClick={handlePlayerClick}
        onShareLocation={handleShareLocation}
        onSpawnClick={handleSpawnClick}
        players={players.data}
        shareCopied={shareCopied}
        worldData={worldData}
      />
    </div>
  );
}
