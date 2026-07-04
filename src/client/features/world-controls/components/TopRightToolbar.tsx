import { uiTheme } from "../../../lib/ui-theme.js";

interface TopRightToolbarProps {
  shareCopied: boolean;
  onShareLocation: () => void;
  compact?: boolean;
}

export function TopRightToolbar({
  shareCopied,
  onShareLocation,
  compact = false,
}: TopRightToolbarProps) {
  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        right: 12,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: compact ? 8 : 10,
      }}
    >
      <button
        type="button"
        onClick={onShareLocation}
        style={{
          padding: compact ? "7px 12px" : "8px 14px",
          border: `2px solid ${shareCopied ? uiTheme.accent.border : uiTheme.panel.buttonBorder}`,
          borderRadius: 0,
          boxShadow: "3px 3px 0 rgba(0,0,0,0.55)",
          background: shareCopied
            ? uiTheme.accent.surfaceActive
            : uiTheme.panel.buttonBackground,
          backdropFilter: "blur(5px)",
          color: shareCopied ? uiTheme.text.onAccent : uiTheme.text.muted,
          fontSize: compact ? 12 : 13,
          fontWeight: 400,
          textTransform: "uppercase",
          cursor: "pointer",
        }}
      >
        {shareCopied ? "Copied" : "Copy Location"}
      </button>
    </div>
  );
}
