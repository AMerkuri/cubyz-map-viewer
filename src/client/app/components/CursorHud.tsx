import { uiTheme } from "../../lib/ui-theme.js";

export function CursorHud({
  cursorHudRef,
  compact,
}: {
  cursorHudRef: React.RefObject<HTMLDivElement | null>;
  compact: boolean;
}) {
  return (
    <div
      ref={cursorHudRef}
      style={{
        display: "none",
        position: "absolute",
        top: compact ? 54 : 12,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1000,
        background: uiTheme.panel.background,
        border: `2px solid ${uiTheme.panel.border}`,
        borderRadius: 0,
        padding: "5px 14px",
        fontSize: 12,
        color: uiTheme.text.secondary,
        pointerEvents: "none",
        textAlign: "center",
        whiteSpace: "pre-line",
        boxShadow: uiTheme.panel.shadow,
        backdropFilter: "blur(5px)",
      }}
    />
  );
}
