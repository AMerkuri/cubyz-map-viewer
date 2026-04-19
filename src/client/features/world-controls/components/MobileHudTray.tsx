import { type ReactNode, useEffect, useState } from "react";
import { uiTheme } from "../../../lib/ui-theme.js";

type MobileHudTab = "controls" | "world" | "debug";

interface MobileHudTrayProps {
  showDebugTab: boolean;
  controlsContent: ReactNode;
  worldContent: ReactNode;
  debugContent?: ReactNode;
}

export function MobileHudTray({
  showDebugTab,
  controlsContent,
  worldContent,
  debugContent,
}: MobileHudTrayProps) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<MobileHudTab>("controls");

  useEffect(() => {
    if (showDebugTab || activeTab !== "debug") return;
    setActiveTab("controls");
  }, [activeTab, showDebugTab]);

  return (
    <div
      style={{
        position: "absolute",
        left: 12,
        right: 12,
        bottom: `calc(12px + env(safe-area-inset-bottom))`,
        zIndex: 1100,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          pointerEvents: "auto",
          display: "grid",
          gap: 0,
          border: `2px solid ${uiTheme.panel.border}`,
          background: uiTheme.panel.background,
          boxShadow: uiTheme.panel.shadow,
          backdropFilter: "blur(5px)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
            padding: "10px 12px",
            background: "rgba(88, 62, 45)",
            color: uiTheme.text.secondary,
            borderBottom: open ? `2px solid ${uiTheme.panel.border}` : "none",
          }}
        >
          <span
            style={{
              color: uiTheme.accent.title,
              fontSize: 14,
              fontWeight: 400,
              textTransform: "uppercase",
              textShadow: "2px 2px 0 rgba(0,0,0,0.8)",
            }}
          >
            Cubyz Map Viewer
          </span>
          <button
            type="button"
            onClick={() => setOpen((next) => !next)}
            title={open ? "Collapse panel" : "Expand panel"}
            style={trayHeaderButtonStyle}
          >
            {open ? "-" : "+"}
          </button>
        </div>

        {open && (
          <div style={{ display: "grid" }}>
            <div
              style={{
                display: "flex",
                borderBottom: `2px solid ${uiTheme.panel.buttonBorder}`,
                overflow: "hidden",
              }}
            >
              <TrayTab
                active={activeTab === "controls"}
                label="Controls"
                onClick={() => setActiveTab("controls")}
                isLast={false}
              />
              <TrayTab
                active={activeTab === "world"}
                label="World"
                onClick={() => setActiveTab("world")}
                isLast={!showDebugTab}
              />
              {showDebugTab && (
                <TrayTab
                  active={activeTab === "debug"}
                  label="Debug"
                  onClick={() => setActiveTab("debug")}
                  isLast={true}
                />
              )}
            </div>

            <div
              style={{
                maxHeight: "min(52vh, 420px)",
                overflowY: "auto",
                padding: 12,
                color: uiTheme.text.secondary,
                fontSize: 12,
                lineHeight: 1.25,
                display: "grid",
                gap: 12,
              }}
            >
              {activeTab === "controls" && controlsContent}
              {activeTab === "world" && worldContent}
              {activeTab === "debug" && showDebugTab && debugContent}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TrayTab({
  active,
  label,
  onClick,
  isLast,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  isLast: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        flex: 1,
        padding: "7px 12px",
        border: 0,
        borderRight: isLast ? 0 : `2px solid ${uiTheme.panel.buttonBorder}`,
        background: active
          ? uiTheme.accent.surfaceActive
          : uiTheme.panel.buttonBackground,
        color: active ? uiTheme.text.onAccent : uiTheme.text.muted,
        cursor: "pointer",
        textTransform: "uppercase",
        fontSize: 12,
        fontWeight: 400,
        borderRadius: 0,
      }}
    >
      {label}
    </button>
  );
}

const trayHeaderButtonStyle: React.CSSProperties = {
  border: `2px solid ${uiTheme.panel.buttonBorder}`,
  background: uiTheme.panel.buttonBackground,
  color: uiTheme.text.primary,
  borderRadius: 0,
  width: 24,
  height: 24,
  cursor: "pointer",
  padding: 0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  boxShadow: "2px 2px 0 rgba(0,0,0,0.65)",
  fontSize: 14,
};
