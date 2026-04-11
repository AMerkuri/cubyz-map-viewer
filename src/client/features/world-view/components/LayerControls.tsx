export interface LayerVisibility {
  biomeLabels: boolean;
  players: boolean;
  spawn: boolean;
  debug: boolean;
  chunkBorders: boolean;
  showTerrain: boolean;
  showVoxelTerrain: boolean;
  voxelHeightLabels: boolean;
}

interface LayerControlsProps {
  visibility: LayerVisibility;
  onChange: (next: LayerVisibility) => void;
  view: "terrain" | "voxel";
  voxelLod1MaxDist: number;
  onVoxelLod1MaxDistChange: (value: number) => void;
}

interface ToggleButtonProps {
  label: string;
  active: boolean;
  onToggle: () => void;
}

function ToggleButton({ label, active, onToggle }: ToggleButtonProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 10px",
        border: "none",
        cursor: "pointer",
        fontSize: 12,
        fontWeight: 500,
        background: "transparent",
        color: active ? "#fff" : "#666",
        textAlign: "left",
        width: "100%",
        transition: "color 0.15s",
      }}
    >
      <span
        style={{
          display: "inline-block",
          width: 10,
          height: 10,
          borderRadius: 2,
          background: active ? "#4a90d9" : "#333",
          border: `1px solid ${active ? "#4a90d9" : "#555"}`,
          flexShrink: 0,
          transition: "background 0.15s, border-color 0.15s",
        }}
      />
      {label}
    </button>
  );
}

export function LayerControls({
  visibility,
  onChange,
  view,
  voxelLod1MaxDist,
  onVoxelLod1MaxDistChange,
}: LayerControlsProps) {
  function toggle(key: keyof LayerVisibility) {
    onChange({ ...visibility, [key]: !visibility[key] });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <ToggleButton
        label="Biome Labels"
        active={visibility.biomeLabels}
        onToggle={() => toggle("biomeLabels")}
      />
      <ToggleButton
        label="Players"
        active={visibility.players}
        onToggle={() => toggle("players")}
      />
      <ToggleButton
        label="Spawn"
        active={visibility.spawn}
        onToggle={() => toggle("spawn")}
      />
      {view === "voxel" && (
        <>
          <ToggleButton
            label="Terrain Underlay"
            active={visibility.showVoxelTerrain}
            onToggle={() => toggle("showVoxelTerrain")}
          />
          <ToggleButton
            label="Debug"
            active={visibility.debug}
            onToggle={() => toggle("debug")}
          />
          <div
            style={{
              padding: "6px 10px",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
                color: "#aaa",
                fontSize: 11,
              }}
            >
              <span>LOD1 Max Dist</span>
              <span style={{ color: "#d6d9ea", fontWeight: 600 }}>
                {voxelLod1MaxDist}
              </span>
            </div>
            <input
              type="range"
              min={200}
              max={1150}
              step={50}
              value={voxelLod1MaxDist}
              onChange={(e) => onVoxelLod1MaxDistChange(Number(e.target.value))}
            />
          </div>
        </>
      )}
      {view === "terrain" && (
        <ToggleButton
          label="Debug"
          active={visibility.debug}
          onToggle={() => toggle("debug")}
        />
      )}
    </div>
  );
}
