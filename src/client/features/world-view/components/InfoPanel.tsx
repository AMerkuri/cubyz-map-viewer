import { useState } from "react";
import { OverlayPanel } from "../../../shared/ui/OverlayPanel.js";
import type { PlayerData } from "../hooks/usePlayers.js";
import type { useWorldData } from "../hooks/useWorldData.js";

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
      minWidth={220}
      maxWidth={320}
      collapsible={true}
      contentStyle={{ fontSize: 12, lineHeight: 1.55 }}
    >
      {loading && <div style={{ color: "#888" }}>Loading world data...</div>}
      {error && <div style={{ color: "#f77" }}>Error: {error}</div>}

      {world && (
        <>
          <InfoRow label="World name" value={world.name} />
          <InfoRow label="Seed" value={String(world.seed)} />
          <InfoRow label="Mode" value={world.defaultGamemode} />
          <InfoRow label="Time" value={formatGameTime(world.gameTime)} />
          <button
            type="button"
            onClick={onSpawnClick}
            onMouseEnter={() => setHoveredSpawn(true)}
            onMouseLeave={() => setHoveredSpawn(false)}
            style={{
              border: "none",
              borderRadius: 4,
              padding: "1px 4px",
              margin: "0 -4px",
              cursor: "pointer",
              background: hoveredSpawn
                ? "rgba(255,255,255,0.07)"
                : "transparent",
              transition: "background 0.1s",
              width: "100%",
              textAlign: "left",
            }}
          >
            <InfoRow
              label="Spawn"
              value={`${world.spawn[0]}, ${world.spawn[1]}, ${world.spawn[2]}`}
            />
          </button>
          {zoomLevel !== null && (
            <InfoRow label="Zoom" value={String(Math.round(zoomLevel))} />
          )}
          <InfoRow
            label="Last update"
            value={lastUpdateAt !== null ? formatDateTime(lastUpdateAt) : "-"}
          />

          {players.length > 0 && (
            <div
              style={{
                marginTop: 8,
                borderTop: "1px solid rgba(255,255,255,0.1)",
                paddingTop: 6,
              }}
            >
              <div style={{ color: "#888", marginBottom: 4 }}>
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
                      border: "none",
                      borderRadius: 4,
                      padding: "1px 4px",
                      margin: "0 -4px",
                      cursor: "pointer",
                      background:
                        hoveredPlayer === i
                          ? "rgba(255,255,255,0.07)"
                          : "transparent",
                      transition: "background 0.1s",
                      width: "100%",
                      textAlign: "left",
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
      <span style={{ color: "#8b92ad" }}>{label}</span>
      <span
        style={{ color: "#ddd", textAlign: "right", wordBreak: "break-all" }}
      >
        {value}
      </span>
    </div>
  );
}

function formatGameTime(ticks: number): string {
  // Game time is in 100ms ticks, 24000 ticks = 1 day
  const dayTicks = ticks % 24000;
  const hours = Math.floor(dayTicks / 1000 + 6) % 24;
  const minutes = Math.floor(((dayTicks % 1000) / 1000) * 60);
  return `Day ${Math.floor(ticks / 24000)}, ${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}

/** Strip Cubyz color formatting codes from player names */
function cleanPlayerName(name: string): string {
  return name.replace(/[*]{1,3}|#[0-9A-Fa-f]{6}/g, "").trim() || "Player";
}

function formatDateTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(timestamp);
}
