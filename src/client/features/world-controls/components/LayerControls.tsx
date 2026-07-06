import { uiTheme } from "../../../lib/ui-theme.js";
import type { LayerVisibility } from "../../../types/world-view.js";

interface LayerControlsProps {
  visibility: LayerVisibility;
  onChange: (next: LayerVisibility) => void;
  compact?: boolean;
}

interface ToggleButtonProps {
  label: string;
  active: boolean;
  onToggle: () => void;
}

function ToggleButton({
  label,
  active,
  onToggle,
  compact = false,
}: ToggleButtonProps & { compact?: boolean }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: compact ? "8px 10px" : "6px 8px",
        border: `2px solid ${active ? uiTheme.accent.border : uiTheme.panel.buttonBorderMuted}`,
        cursor: "pointer",
        fontSize: compact ? 13 : 12,
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
  compact = false,
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
        compact={compact}
      />
      <ToggleButton
        label="Players"
        active={visibility.players}
        onToggle={() => toggle("players")}
        compact={compact}
      />
      <ToggleButton
        label="Spawn"
        active={visibility.spawn}
        onToggle={() => toggle("spawn")}
        compact={compact}
      />
      <ToggleButton
        label="Terrain Underlay"
        active={visibility.showTerrainUnderlay}
        onToggle={() => toggle("showTerrainUnderlay")}
        compact={compact}
      />
      <ToggleButton
        label="Advanced"
        active={visibility.debug}
        onToggle={() => toggle("debug")}
        compact={compact}
      />
    </div>
  );
}
