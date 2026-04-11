import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

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

interface PanelOffset {
  x: number;
  y: number;
}

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
}: OverlayPanelProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [offset, setOffset] = useState<PanelOffset>({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    startPointerX: number;
    startPointerY: number;
    startOffsetX: number;
    startOffsetY: number;
  } | null>(null);

  const baseStyle = useMemo(() => {
    if (!absolute) {
      return {
        position: "relative" as const,
      };
    }

    return {
      position: "absolute" as const,
      ...(position ?? {}),
    };
  }, [absolute, position]);

  useEffect(() => {
    if (!absolute) return;

    const handlePointerMove = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) return;

      const panel = panelRef.current;
      if (!panel) return;

      const nextOffset = {
        x: dragState.startOffsetX + (event.clientX - dragState.startPointerX),
        y: dragState.startOffsetY + (event.clientY - dragState.startPointerY),
      };
      setOffset(applySnapToViewport(nextOffset, panel, position));
    };

    const stopDragging = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) return;
      dragStateRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
    };
  }, [absolute, position]);

  const moved = offset.x !== 0 || offset.y !== 0;

  const panelStyle: React.CSSProperties = {
    ...baseStyle,
    zIndex,
    background: "rgba(26, 26, 46, 0.82)",
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 8,
    boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
    backdropFilter: "blur(10px)",
    minWidth,
    maxWidth,
    transform: absolute ? `translate(${offset.x}px, ${offset.y}px)` : undefined,
  };

  return (
    <div ref={panelRef} style={panelStyle}>
      <div
        onPointerDown={(event) => {
          if (!absolute) return;
          if (event.button !== 0) return;
          if (
            event.target instanceof HTMLElement &&
            event.target.closest("button")
          )
            return;

          dragStateRef.current = {
            pointerId: event.pointerId,
            startPointerX: event.clientX,
            startPointerY: event.clientY,
            startOffsetX: offset.x,
            startOffsetY: offset.y,
          };
          (event.currentTarget as HTMLDivElement).setPointerCapture(
            event.pointerId,
          );
        }}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: "10px 12px",
          borderBottom: collapsed ? "none" : "1px solid rgba(255,255,255,0.09)",
          cursor: absolute ? "grab" : "default",
          userSelect: "none",
        }}
      >
        <div style={{ color: "#7aa2f7", fontSize: 14, fontWeight: 700 }}>
          {title}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {headerRight}
          {moved && absolute && (
            <button
              type="button"
              onClick={() => setOffset({ x: 0, y: 0 })}
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
            padding: "10px 12px",
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

function applySnapToViewport(
  offset: PanelOffset,
  panel: HTMLDivElement,
  position: OverlayPanelProps["position"],
): PanelOffset {
  const rect = panel.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const bounds = getPanelBounds(rect, position, viewportWidth, viewportHeight);
  let nextOffset = clampOffsetToBounds(offset, bounds);

  if (Math.abs(nextOffset.x) <= SNAP_DISTANCE_PX) {
    nextOffset = { ...nextOffset, x: 0 };
  }
  if (Math.abs(nextOffset.x - bounds.minX) <= SNAP_DISTANCE_PX) {
    nextOffset = { ...nextOffset, x: bounds.minX };
  }
  if (Math.abs(nextOffset.x - bounds.maxX) <= SNAP_DISTANCE_PX) {
    nextOffset = { ...nextOffset, x: bounds.maxX };
  }

  if (Math.abs(nextOffset.y) <= SNAP_DISTANCE_PX) {
    nextOffset = { ...nextOffset, y: 0 };
  }
  if (Math.abs(nextOffset.y - bounds.minY) <= SNAP_DISTANCE_PX) {
    nextOffset = { ...nextOffset, y: bounds.minY };
  }
  if (Math.abs(nextOffset.y - bounds.maxY) <= SNAP_DISTANCE_PX) {
    nextOffset = { ...nextOffset, y: bounds.maxY };
  }

  return clampOffsetToBounds(nextOffset, bounds);
}

function clampOffsetToBounds(
  offset: PanelOffset,
  bounds: PanelBounds,
): PanelOffset {
  return {
    x: clamp(offset.x, bounds.minX, bounds.maxX),
    y: clamp(offset.y, bounds.minY, bounds.maxY),
  };
}

interface PanelBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function getPanelBounds(
  rect: DOMRect,
  position: OverlayPanelProps["position"],
  viewportWidth: number,
  viewportHeight: number,
): PanelBounds {
  const horizontalPadding = position?.left ?? position?.right ?? 12;
  const verticalPadding = position?.top ?? position?.bottom ?? 12;
  const baseLeft =
    position?.left ??
    (position?.right !== undefined
      ? viewportWidth - position.right - rect.width
      : horizontalPadding);
  const baseTop =
    position?.top ??
    (position?.bottom !== undefined
      ? viewportHeight - position.bottom - rect.height
      : verticalPadding);

  return {
    minX: horizontalPadding - baseLeft,
    maxX: viewportWidth - rect.width - horizontalPadding - baseLeft,
    minY: verticalPadding - baseTop,
    maxY: viewportHeight - rect.height - verticalPadding - baseTop,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

const headerButtonStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(255,255,255,0.06)",
  color: "#cfd8ff",
  borderRadius: 4,
  width: 22,
  height: 22,
  cursor: "pointer",
  padding: 0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
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
