import { useState, type ReactNode } from "react";

interface OverlayPanelProps {
  title: string;
  children: ReactNode;
  position?: {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
  };
  absolute?: boolean;
  minWidth?: number;
  maxWidth?: number;
  zIndex?: number;
  headerRight?: ReactNode;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  contentStyle?: React.CSSProperties;
}

export function OverlayPanel({
  title,
  children,
  position,
  absolute = true,
  minWidth,
  maxWidth,
  zIndex = 1000,
  headerRight,
  collapsible = false,
  defaultCollapsed = false,
  contentStyle,
}: OverlayPanelProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <div
      style={{
        position: absolute ? "absolute" : "relative",
        ...(absolute ? position : {}),
        zIndex,
        background: "rgba(26, 26, 46, 0.82)",
        border: "1px solid rgba(255,255,255,0.14)",
        borderRadius: 8,
        boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
        backdropFilter: "blur(10px)",
        minWidth,
        maxWidth,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: "10px 12px",
          borderBottom: collapsed ? "none" : "1px solid rgba(255,255,255,0.09)",
        }}
      >
        <div style={{ color: "#7aa2f7", fontSize: 14, fontWeight: 700 }}>{title}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {headerRight}
          {collapsible && (
            <button
              onClick={() => setCollapsed((v) => !v)}
              style={{
                border: "1px solid rgba(255,255,255,0.18)",
                background: "rgba(255,255,255,0.06)",
                color: "#cfd8ff",
                borderRadius: 4,
                width: 22,
                height: 22,
                lineHeight: "20px",
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
                padding: 0,
              }}
              title={collapsed ? "Restore panel" : "Minimize panel"}
            >
              {collapsed ? "+" : "-"}
            </button>
          )}
        </div>
      </div>
      {!collapsed && <div style={{ padding: "10px 12px", ...contentStyle }}>{children}</div>}
    </div>
  );
}
