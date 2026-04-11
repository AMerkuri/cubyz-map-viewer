import { uiTheme } from "../../../shared/ui/theme.js";

interface ViewToggleProps {
  view: "terrain" | "voxel";
  onViewChange: (view: "terrain" | "voxel") => void;
}

export function ViewToggle({ view, onViewChange }: ViewToggleProps) {
  return (
    <div
      style={{
        display: "flex",
        gap: 0,
        borderRadius: 6,
        overflow: "hidden",
        boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
      }}
    >
      <button
        type="button"
        onClick={() => onViewChange("terrain")}
        style={{
          padding: "8px 16px",
          border: "none",
          cursor: "pointer",
          fontSize: 13,
          fontWeight: 600,
          background:
            view === "terrain"
              ? uiTheme.accent.surfaceActive
              : uiTheme.panel.buttonBackgroundMuted,
          color:
            view === "terrain" ? uiTheme.text.onAccent : uiTheme.text.muted,
          transition: "all 0.2s",
        }}
      >
        Terrain
      </button>
      <button
        type="button"
        onClick={() => onViewChange("voxel")}
        style={{
          padding: "8px 16px",
          border: "none",
          cursor: "pointer",
          fontSize: 13,
          fontWeight: 600,
          background:
            view === "voxel"
              ? uiTheme.accent.surfaceActive
              : uiTheme.panel.buttonBackgroundMuted,
          color: view === "voxel" ? uiTheme.text.onAccent : uiTheme.text.muted,
          transition: "all 0.2s",
        }}
      >
        Voxels
      </button>
    </div>
  );
}
