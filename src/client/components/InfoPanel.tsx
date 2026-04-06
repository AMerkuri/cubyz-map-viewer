import type { useWorldData } from "../hooks/useWorldData.js";
import type { PlayerData } from "../hooks/usePlayers.js";

interface InfoPanelProps {
  worldData: ReturnType<typeof useWorldData>;
  players: PlayerData[];
  cursorPos: [number, number] | null;
  view: "2d" | "3d";
  wsConnected: boolean;
}

export function InfoPanel({
  worldData,
  players,
  cursorPos,
  view,
  wsConnected,
}: InfoPanelProps) {
  const { worldData: world, loading, error } = worldData;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 12,
        left: 12,
        zIndex: 1000,
        background: "rgba(26, 26, 46, 0.92)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 8,
        padding: "12px 16px",
        minWidth: 220,
        maxWidth: 320,
        fontSize: 12,
        lineHeight: 1.6,
        boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
        backdropFilter: "blur(10px)",
      }}
    >
      <div
        style={{
          fontSize: 15,
          fontWeight: 700,
          marginBottom: 8,
          color: "#7aa2f7",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span>Cubyz Map Viewer</span>
        <span
          title={wsConnected ? "Live updates connected" : "Live updates disconnected"}
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: wsConnected ? "#4ade80" : "#666",
            boxShadow: wsConnected ? "0 0 6px rgba(74,222,128,0.6)" : "none",
            display: "inline-block",
          }}
        />
      </div>

      {loading && <div style={{ color: "#888" }}>Loading world data...</div>}
      {error && <div style={{ color: "#f77" }}>Error: {error}</div>}

      {world && (
        <>
          <InfoRow label="World" value={world.name} />
          <InfoRow label="Seed" value={String(world.seed)} />
          <InfoRow
            label="Spawn"
            value={`${world.spawn[0]}, ${world.spawn[1]}, ${world.spawn[2]}`}
          />
          <InfoRow label="Mode" value={world.defaultGamemode} />
          <InfoRow
            label="Time"
            value={formatGameTime(world.gameTime)}
          />

          {players.length > 0 && (
            <div style={{ marginTop: 8, borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: 6 }}>
              <div style={{ color: "#888", marginBottom: 4 }}>
                Players ({players.length})
              </div>
              {players.map((p, i) => (
                <InfoRow
                  key={i}
                  label={cleanPlayerName(p.name)}
                  value={`${Math.round(p.position[0])}, ${Math.round(p.position[1])}, ${Math.round(p.position[2])}`}
                />
              ))}
            </div>
          )}

          {cursorPos && view === "2d" && (
            <div
              style={{
                marginTop: 6,
                paddingTop: 6,
                borderTop: "1px solid rgba(255,255,255,0.1)",
                color: "#aaa",
              }}
            >
              Cursor: {cursorPos[0]}, {cursorPos[1]}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span style={{ color: "#888" }}>{label}</span>
      <span style={{ color: "#ddd", textAlign: "right", wordBreak: "break-all" }}>
        {value}
      </span>
    </div>
  );
}

function formatGameTime(ticks: number): string {
  // Game time is in 100ms ticks, 24000 ticks = 1 day
  const dayTicks = ticks % 24000;
  const hours = Math.floor((dayTicks / 1000) + 6) % 24;
  const minutes = Math.floor((dayTicks % 1000) / 1000 * 60);
  return `Day ${Math.floor(ticks / 24000)}, ${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}

/** Strip Cubyz color formatting codes from player names */
function cleanPlayerName(name: string): string {
  return name.replace(/[*]{1,3}|#[0-9A-Fa-f]{6}/g, "").trim() || "Player";
}
