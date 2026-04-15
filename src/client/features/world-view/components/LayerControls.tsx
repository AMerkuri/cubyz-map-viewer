import { uiTheme } from "../../../shared/ui/theme.js";

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
        padding: "6px 8px",
        border: `2px solid ${active ? uiTheme.accent.border : uiTheme.panel.buttonBorderMuted}`,
        cursor: "pointer",
        fontSize: 12,
        fontWeight: 400,
        background: active
          ? uiTheme.accent.surface
          : uiTheme.panel.buttonBackgroundMuted,
        color: active ? uiTheme.text.onAccent : uiTheme.text.muted,
        textAlign: "left",
        width: "100%",
        borderRadius: 0,
        boxShadow: "2px 2px 0 rgba(0,0,0,0.55)",
        textTransform: "uppercase",
      }}
    >
      <span
        style={{
          display: "inline-block",
          width: 10,
          height: 10,
          borderRadius: 0,
          background: active
            ? uiTheme.accent.surfaceActive
            : uiTheme.panel.buttonBackgroundMuted,
          border: `2px solid ${active ? uiTheme.accent.border : uiTheme.panel.buttonBorderMuted}`,
          flexShrink: 0,
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
}: LayerControlsProps) {
  function toggle(key: keyof LayerVisibility) {
    onChange({ ...visibility, [key]: !visibility[key] });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
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
