import { useState } from "react";
import { OverlayPanel } from "../../../shared/ui/OverlayPanel.js";
import type { PlayerData } from "../hooks/usePlayers.js";
import type { useWorldData } from "../hooks/useWorldData.js";
import { cleanPlayerName } from "../lib/utils.js";

const infoPanelTheme = {
  border: "#8ea3b5",
  shadow: "4px 4px 0 rgba(0,0,0,0.72)",
  muted: "#aab5c1",
  secondary: "#e6e8ed",
  hover: "#20262d",
} as const;

interface InfoPanelProps {
  worldData: ReturnType<typeof useWorldData>;
  players: PlayerData[];
  lastUpdateAt: number | null;
  zoomLevel: number | null;
  onPlayerClick: (player: PlayerData) => void;
  onSpawnClick: () => void;
}

export function InfoPanel({
  worldData,
  players,
  lastUpdateAt,
  zoomLevel,
  onPlayerClick,
  onSpawnClick,
}: InfoPanelProps) {
  const { worldData: world, loading, error } = worldData;
  const [hoveredPlayer, setHoveredPlayer] = useState<number | null>(null);
  const [hoveredSpawn, setHoveredSpawn] = useState(false);

  return (
    <OverlayPanel
      title="Cubyz Map Viewer"
      position={{ bottom: 12, left: 12 }}
      minWidth={250}
      maxWidth={320}
      collapsible={true}
      contentStyle={{
        fontSize: 12,
        lineHeight: 1.25,
        color: infoPanelTheme.secondary,
      }}
      style={{
        boxShadow: infoPanelTheme.shadow,
      }}
    >
      {loading && (
        <div style={{ color: infoPanelTheme.muted }}>Loading world data...</div>
      )}
      {error && <div style={{ color: "#f77" }}>Error: {error}</div>}

      {world && (
        <>
          <InfoRow label="World name" value={world.name} />
          <InfoRow label="Seed" value={String(world.seed)} />
          {zoomLevel !== null && (
            <InfoRow label="Zoom" value={String(Math.round(zoomLevel))} />
          )}
          <InfoRow
            label="Last update"
            value={lastUpdateAt !== null ? formatTime(lastUpdateAt) : "-"}
          />
          <button
            type="button"
            onClick={onSpawnClick}
            onMouseEnter={() => setHoveredSpawn(true)}
            onMouseLeave={() => setHoveredSpawn(false)}
            style={{
              border: `2px solid ${hoveredSpawn ? infoPanelTheme.border : "transparent"}`,
              borderRadius: 0,
              padding: "3px 4px",
              margin: "-1px -6px",
              cursor: "pointer",
              background: hoveredSpawn ? infoPanelTheme.hover : "transparent",
              width: "100%",
              textAlign: "left",
              boxSizing: "content-box",
              boxShadow: hoveredSpawn ? "2px 2px 0 rgba(0,0,0,0.5)" : "none",
            }}
          >
            <InfoRow
              label="Spawn"
              value={`${world.spawn[0]}, ${world.spawn[1]}, ${world.spawn[2]}`}
            />
          </button>

          {players.length > 0 && (
            <div
              style={{
                marginTop: 8,
                borderTop: `2px solid ${infoPanelTheme.border}`,
                paddingTop: 6,
              }}
            >
              <div style={{ color: infoPanelTheme.muted, marginBottom: 4 }}>
                Players ({players.length})
              </div>
              {players.map((p, i) => {
                const playerKey = `${p.name}:${p.position.join(",")}`;
                return (
                  <button
                    type="button"
                    key={playerKey}
                    onClick={() => onPlayerClick(p)}
                    onMouseEnter={() => setHoveredPlayer(i)}
                    onMouseLeave={() => setHoveredPlayer(null)}
                    style={{
                      border: `2px solid ${hoveredPlayer === i ? infoPanelTheme.border : "transparent"}`,
                      borderRadius: 0,
                      padding: "3px 4px",
                      margin: "-1px -6px",
                      cursor: "pointer",
                      background:
                        hoveredPlayer === i
                          ? infoPanelTheme.hover
                          : "transparent",
                      width: "100%",
                      textAlign: "left",
                      boxShadow:
                        hoveredPlayer === i
                          ? "2px 2px 0 rgba(0,0,0,0.5)"
                          : "none",
                      boxSizing: "content-box",
                    }}
                  >
                    <InfoRow
                      label={cleanPlayerName(p.name)}
                      value={`${Math.round(p.position[0])}, ${Math.round(p.position[1])}, ${Math.round(p.position[2])}`}
                    />
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
    </OverlayPanel>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span style={{ color: infoPanelTheme.muted, textTransform: "uppercase" }}>
        {label}
      </span>
      <span
        style={{
          color: infoPanelTheme.secondary,
          textAlign: "right",
          wordBreak: "break-all",
          textShadow: "1px 1px 0 rgba(0,0,0,0.75)",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}:${date.getSeconds().toString().padStart(2, "0")}`;
}
