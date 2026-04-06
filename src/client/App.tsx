import { useState, useEffect, useCallback } from "react";
import { Map2D } from "./components/Map2D.js";
import { Map3D } from "./components/Map3D.js";
import { ViewToggle } from "./components/ViewToggle.js";
import { InfoPanel } from "./components/InfoPanel.js";
import { useWorldData } from "./hooks/useWorldData.js";
import { usePlayers } from "./hooks/usePlayers.js";
import { useWebSocket } from "./hooks/useWebSocket.js";

export function App() {
  const [view, setView] = useState<"2d" | "3d">("2d");
  const [cursorPos, setCursorPos] = useState<[number, number] | null>(null);
  const worldData = useWorldData();
  const players = usePlayers();
  const { connected, subscribe } = useWebSocket();

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
      })
    );

    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [subscribe, players.refresh, worldData.refresh, worldData.refreshSurfaceIndex]);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {view === "2d" ? (
        <Map2D
          worldData={worldData}
          players={players.data}
          onCursorMove={setCursorPos}
          subscribe={subscribe}
        />
      ) : (
        <Map3D
          worldData={worldData}
          players={players.data}
          subscribe={subscribe}
        />
      )}

      <ViewToggle view={view} onViewChange={setView} />
      <InfoPanel
        worldData={worldData}
        players={players.data}
        cursorPos={cursorPos}
        view={view}
        wsConnected={connected}
      />
    </div>
  );
}
