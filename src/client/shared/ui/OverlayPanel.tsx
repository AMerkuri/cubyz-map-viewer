import { type ReactNode, useEffect, useRef, useState } from "react";
import { uiTheme } from "./theme.js";

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
  style?: React.CSSProperties;
}

interface PanelPosition {
  left: number;
  top: number;
}

interface PanelBounds {
  minLeft: number;
  maxLeft: number;
  minTop: number;
  maxTop: number;
}

const VIEWPORT_EDGE_PADDING_PX = 12;
const SNAP_DISTANCE_PX = 24;
const RESET_GLYPH_SIZE = 12;

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
  style,
}: OverlayPanelProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [panelPosition, setPanelPosition] = useState<PanelPosition | null>(
    null,
  );
  const [dragging, setDragging] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    startPointerX: number;
    startPointerY: number;
    startLeft: number;
    startTop: number;
  } | null>(null);

  useEffect(() => {
    if (!absolute || !panelPosition) return;

    const handleResize = () => {
      const panel = panelRef.current;
      if (!panel) return;
      setPanelPosition((current) => {
        if (!current) return current;
        return clampPositionToViewport(current, panel);
      });
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [absolute, panelPosition]);

  useEffect(() => {
    if (!absolute || !dragging) return;

    const handlePointerMove = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) return;

      const panel = panelRef.current;
      if (!panel) return;

      const nextPosition = {
        left: dragState.startLeft + (event.clientX - dragState.startPointerX),
        top: dragState.startTop + (event.clientY - dragState.startPointerY),
      };
      setPanelPosition(clampPositionToViewport(nextPosition, panel));
    };

    const stopDragging = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) return;
      dragStateRef.current = null;
      setDragging(false);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
    };
  }, [absolute, dragging]);

  const moved = panelPosition !== null;
  const panelContainerStyle: React.CSSProperties = {
    position: absolute ? "absolute" : "relative",
    ...(absolute
      ? panelPosition
        ? { left: panelPosition.left, top: panelPosition.top }
        : { ...(position ?? {}) }
      : {}),
    zIndex,
    background: uiTheme.panel.background,
    border: `2px solid ${uiTheme.panel.border}`,
    borderRadius: 0,
    boxShadow: uiTheme.panel.shadow,
    backdropFilter: "blur(5px)",
    minWidth,
    maxWidth,
    imageRendering: "pixelated",
    ...style,
  };

  return (
    <div ref={panelRef} style={panelContainerStyle}>
      <div
        onPointerDown={(event) => {
          if (!absolute) return;
          if (event.button !== 0) return;
          if (
            event.target instanceof HTMLElement &&
            event.target.closest("button")
          )
            return;

          const panel = panelRef.current;
          if (!panel) return;
          const rect = panel.getBoundingClientRect();

          dragStateRef.current = {
            pointerId: event.pointerId,
            startPointerX: event.clientX,
            startPointerY: event.clientY,
            startLeft: rect.left,
            startTop: rect.top,
          };
          setDragging(true);
          (event.currentTarget as HTMLDivElement).setPointerCapture(
            event.pointerId,
          );
        }}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "8px 10px",
          borderBottom: collapsed
            ? "none"
            : `2px solid ${uiTheme.panel.border}`,
          background: "rgba(88, 62, 45)",
          cursor: absolute ? "grab" : "default",
          userSelect: "none",
        }}
      >
        <div
          style={{
            color: uiTheme.accent.title,
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: 1,
            textTransform: "uppercase",
            textShadow: "2px 2px 0 rgba(0,0,0,0.8)",
          }}
        >
          {title}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {headerRight}
          {moved && absolute && (
            <button
              type="button"
              onClick={() => setPanelPosition(null)}
              style={headerButtonStyle}
              title="Reset panel position"
              aria-label="Reset panel position"
            >
              <ResetGlyph />
            </button>
          )}
          {collapsible && (
            <button
              type="button"
              onClick={() => setCollapsed((v) => !v)}
              style={headerButtonStyle}
              title={collapsed ? "Restore panel" : "Minimize panel"}
            >
              {collapsed ? "+" : "-"}
            </button>
          )}
        </div>
      </div>
      {!collapsed && (
        <div
          style={{
            padding: "8px 10px",
            maxHeight: "min(70vh, calc(100vh - 96px))",
            overflowY: "auto",
            ...contentStyle,
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function clampPositionToViewport(
  position: PanelPosition,
  panel: HTMLDivElement,
): PanelPosition {
  const rect = panel.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const bounds = getPanelBounds(rect, viewportWidth, viewportHeight);
  let nextPosition = clampPositionToBounds(position, bounds);

  if (Math.abs(nextPosition.left - bounds.minLeft) <= SNAP_DISTANCE_PX) {
    nextPosition = { ...nextPosition, left: bounds.minLeft };
  }
  if (Math.abs(nextPosition.left - bounds.maxLeft) <= SNAP_DISTANCE_PX) {
    nextPosition = { ...nextPosition, left: bounds.maxLeft };
  }
  if (Math.abs(nextPosition.top - bounds.minTop) <= SNAP_DISTANCE_PX) {
    nextPosition = { ...nextPosition, top: bounds.minTop };
  }
  if (Math.abs(nextPosition.top - bounds.maxTop) <= SNAP_DISTANCE_PX) {
    nextPosition = { ...nextPosition, top: bounds.maxTop };
  }

  return clampPositionToBounds(nextPosition, bounds);
}

function clampPositionToBounds(
  position: PanelPosition,
  bounds: PanelBounds,
): PanelPosition {
  return {
    left: clamp(position.left, bounds.minLeft, bounds.maxLeft),
    top: clamp(position.top, bounds.minTop, bounds.maxTop),
  };
}

function getPanelBounds(
  rect: DOMRect,
  viewportWidth: number,
  viewportHeight: number,
): PanelBounds {
  return {
    minLeft: VIEWPORT_EDGE_PADDING_PX,
    maxLeft: viewportWidth - rect.width - VIEWPORT_EDGE_PADDING_PX,
    minTop: VIEWPORT_EDGE_PADDING_PX,
    maxTop: viewportHeight - rect.height - VIEWPORT_EDGE_PADDING_PX,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

const headerButtonStyle: React.CSSProperties = {
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
};

function ResetGlyph() {
  return (
    <svg
      width={RESET_GLYPH_SIZE}
      height={RESET_GLYPH_SIZE}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ pointerEvents: "none", display: "block" }}
    >
      <path d="M3 12a9 9 0 1 0 3-6.708" />
      <path d="M3 3v6h6" />
    </svg>
  );
}
