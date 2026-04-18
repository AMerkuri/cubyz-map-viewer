import { uiTheme } from "../../../lib/ui-theme.js";
import type { WorldViewMode } from "../../../types/world-view.js";

interface ViewToggleProps {
  view: WorldViewMode;
  onViewChange: (view: WorldViewMode) => void;
  compact?: boolean;
}

export function ViewToggle({
  view,
  onViewChange,
  compact = false,
}: ViewToggleProps) {
  return (
    <div
      style={{
        display: "flex",
        gap: 0,
        borderRadius: 0,
        overflow: "hidden",
        border: `2px solid ${uiTheme.panel.buttonBorder}`,
        boxShadow: "3px 3px 0 rgba(0,0,0,0.55)",
        backdropFilter: "blur(5px)",
      }}
    >
      <button
        type="button"
        onClick={() => onViewChange("terrain")}
        style={{
          padding: compact ? "7px 12px" : "8px 16px",
          border: "none",
          cursor: "pointer",
          fontSize: compact ? 12 : 13,
          fontWeight: 400,
          textTransform: "uppercase",
          background:
            view === "terrain"
              ? uiTheme.accent.surfaceActive
              : uiTheme.panel.buttonBackground,
          color:
            view === "terrain" ? uiTheme.text.onAccent : uiTheme.text.muted,
        }}
      >
        Terrain
      </button>
      <button
        type="button"
        onClick={() => onViewChange("voxel")}
        style={{
          padding: compact ? "7px 12px" : "8px 16px",
          border: "none",
          borderLeft: `2px solid ${uiTheme.panel.buttonBorder}`,
          cursor: "pointer",
          fontSize: compact ? 12 : 13,
          fontWeight: 400,
          textTransform: "uppercase",
          background:
            view === "voxel"
              ? uiTheme.accent.surfaceActive
              : uiTheme.panel.buttonBackground,
          color: view === "voxel" ? uiTheme.text.onAccent : uiTheme.text.muted,
        }}
      >
        Voxels
      </button>
    </div>
  );
}
