import {
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { uiTheme } from "../lib/ui-theme.js";

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
const PANEL_LAYER_MAX_Z_INDEX = 999;

let nextPanelStackId = 0;
const panelStackOrder: number[] = [];
const panelStackListeners = new Set<() => void>();

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
  const [defaultPosition, setDefaultPosition] = useState<PanelPosition | null>(
    null,
  );
  const [dragging, setDragging] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const panelStackIdRef = useRef(nextPanelStackId++);
  const dragStateRef = useRef<{
    pointerId: number;
    startPointerX: number;
    startPointerY: number;
    startLeft: number;
    startTop: number;
  } | null>(null);
  const panelStackSnapshot = useSyncExternalStore(
    subscribeToPanelStack,
    () => getPanelStackSnapshot(panelStackIdRef.current),
    () => "-1:0",
  );
  const [panelStackIndex, panelStackCount] = panelStackSnapshot
    .split(":")
    .map(Number);

  useEffect(() => {
    if (!absolute) return;

    registerPanel(panelStackIdRef.current);
    return () => {
      unregisterPanel(panelStackIdRef.current);
    };
  }, [absolute]);

  useEffect(() => {
    if (!absolute) return;

    const handleResize = () => {
      const panel = panelRef.current;
      if (!panel) return;

      const nextDefaultPosition = getDefaultPanelPosition(
        panel,
        position,
        defaultPosition,
      );
      setDefaultPosition((current) =>
        current && arePanelPositionsEqual(current, nextDefaultPosition)
          ? current
          : nextDefaultPosition,
      );
      setPanelPosition((current) => {
        if (!current) return current;
        const nextPosition = clampPositionToViewport(current, panel);
        return arePanelPositionsEqual(nextPosition, nextDefaultPosition)
          ? null
          : nextPosition;
      });
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [absolute, defaultPosition, position]);

  useEffect(() => {
    if (!absolute || !dragging) return;

    const handlePointerMove = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) return;

      const panel = panelRef.current;
      if (!panel) return;
      const defaultPanelPosition = getDefaultPanelPosition(
        panel,
        position,
        defaultPosition,
      );

      const nextPosition = {
        left: dragState.startLeft + (event.clientX - dragState.startPointerX),
        top: dragState.startTop + (event.clientY - dragState.startPointerY),
      };
      const clampedPosition = clampPositionToViewport(nextPosition, panel);
      setPanelPosition(
        arePanelPositionsEqual(clampedPosition, defaultPanelPosition)
          ? null
          : clampedPosition,
      );
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
  }, [absolute, defaultPosition, dragging, position]);

  const moved = panelPosition !== null;
  const effectiveZIndex = absolute
    ? getStackedPanelZIndex(zIndex, panelStackIndex, panelStackCount)
    : zIndex;
  const panelContainerStyle: React.CSSProperties = {
    position: absolute ? "absolute" : "relative",
    ...(absolute
      ? panelPosition
        ? { left: panelPosition.left, top: panelPosition.top }
        : { ...(position ?? {}) }
      : {}),
    zIndex: effectiveZIndex,
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
    <div
      ref={panelRef}
      onPointerDownCapture={() => {
        if (!absolute) return;

        bringPanelToFront(panelStackIdRef.current);
      }}
      style={panelContainerStyle}
    >
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

          const currentPanelPosition =
            panelPosition ??
            getDefaultPanelPosition(panel, position, defaultPosition);

          dragStateRef.current = {
            pointerId: event.pointerId,
            startPointerX: event.clientX,
            startPointerY: event.clientY,
            startLeft: currentPanelPosition.left,
            startTop: currentPanelPosition.top,
          };
          setDragging(true);
          bringPanelToFront(panelStackIdRef.current);
          (event.currentTarget as HTMLElement).setPointerCapture(
            event.pointerId,
          );
        }}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "8px 10px",
          background: "rgba(88, 62, 45)",
          borderBottom: collapsed
            ? "none"
            : `2px solid ${uiTheme.panel.border}`,
          color: uiTheme.text.secondary,
          cursor: absolute ? (dragging ? "grabbing" : "grab") : "default",
          touchAction: absolute ? "none" : undefined,
          userSelect: "none",
          textTransform: "uppercase",
          fontSize: 14,
          fontWeight: 400,
          textShadow: "2px 2px 0 rgba(0,0,0,0.8)",
        }}
      >
        <span style={{ color: uiTheme.accent.title }}>{title}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {headerRight}
          {moved && (
            <button
              type="button"
              onClick={() => setPanelPosition(null)}
              title="Reset position"
              style={headerButtonStyle}
            >
              {String.fromCharCode(8634).slice(0, RESET_GLYPH_SIZE)}
            </button>
          )}
          {collapsible && (
            <button
              type="button"
              onClick={() => setCollapsed((value) => !value)}
              title={collapsed ? "Expand panel" : "Collapse panel"}
              style={headerButtonStyle}
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
            color: uiTheme.text.secondary,
            ...contentStyle,
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
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
  fontSize: 14,
};

function getDefaultPanelPosition(
  panel: HTMLDivElement,
  position: OverlayPanelProps["position"],
  fallback: PanelPosition | null,
): PanelPosition {
  const panelWidth = panel.offsetWidth;
  const panelHeight = panel.offsetHeight;
  const maxLeft = Math.max(
    VIEWPORT_EDGE_PADDING_PX,
    window.innerWidth - panelWidth - VIEWPORT_EDGE_PADDING_PX,
  );
  const maxTop = Math.max(
    VIEWPORT_EDGE_PADDING_PX,
    window.innerHeight - panelHeight - VIEWPORT_EDGE_PADDING_PX,
  );

  const left =
    position?.left ??
    (position?.right !== undefined
      ? window.innerWidth - panelWidth - position.right
      : (fallback?.left ?? VIEWPORT_EDGE_PADDING_PX));
  const top =
    position?.top ??
    (position?.bottom !== undefined
      ? window.innerHeight - panelHeight - position.bottom
      : (fallback?.top ?? VIEWPORT_EDGE_PADDING_PX));

  return {
    left: clamp(left, VIEWPORT_EDGE_PADDING_PX, maxLeft),
    top: clamp(top, VIEWPORT_EDGE_PADDING_PX, maxTop),
  };
}

function clampPositionToViewport(
  position: PanelPosition,
  panel: HTMLDivElement,
): PanelPosition {
  const bounds = getPanelBounds(panel);
  const snappedLeft = snapCoordinate(
    position.left,
    bounds.minLeft,
    bounds.maxLeft,
  );
  const snappedTop = snapCoordinate(position.top, bounds.minTop, bounds.maxTop);

  return {
    left: clamp(snappedLeft, bounds.minLeft, bounds.maxLeft),
    top: clamp(snappedTop, bounds.minTop, bounds.maxTop),
  };
}

function getPanelBounds(panel: HTMLDivElement): PanelBounds {
  return {
    minLeft: VIEWPORT_EDGE_PADDING_PX,
    maxLeft: Math.max(
      VIEWPORT_EDGE_PADDING_PX,
      window.innerWidth - panel.offsetWidth - VIEWPORT_EDGE_PADDING_PX,
    ),
    minTop: VIEWPORT_EDGE_PADDING_PX,
    maxTop: Math.max(
      VIEWPORT_EDGE_PADDING_PX,
      window.innerHeight - panel.offsetHeight - VIEWPORT_EDGE_PADDING_PX,
    ),
  };
}

function snapCoordinate(value: number, min: number, max: number) {
  if (Math.abs(value - min) <= SNAP_DISTANCE_PX) return min;
  if (Math.abs(value - max) <= SNAP_DISTANCE_PX) return max;
  return value;
}

function arePanelPositionsEqual(
  a: PanelPosition | null,
  b: PanelPosition | null,
) {
  return a?.left === b?.left && a?.top === b?.top;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function subscribeToPanelStack(listener: () => void) {
  panelStackListeners.add(listener);
  return () => {
    panelStackListeners.delete(listener);
  };
}

function emitPanelStackChange() {
  for (const listener of panelStackListeners) listener();
}

function registerPanel(id: number) {
  if (!panelStackOrder.includes(id)) {
    panelStackOrder.push(id);
    emitPanelStackChange();
  }
}

function unregisterPanel(id: number) {
  const index = panelStackOrder.indexOf(id);
  if (index !== -1) {
    panelStackOrder.splice(index, 1);
    emitPanelStackChange();
  }
}

function bringPanelToFront(id: number) {
  const index = panelStackOrder.indexOf(id);
  if (index === -1 || index === panelStackOrder.length - 1) return;
  panelStackOrder.splice(index, 1);
  panelStackOrder.push(id);
  emitPanelStackChange();
}

function getPanelStackSnapshot(id: number) {
  return `${panelStackOrder.indexOf(id)}:${panelStackOrder.length}`;
}

function getStackedPanelZIndex(base: number, index: number, count: number) {
  if (index < 0 || count <= 1) return base;
  return Math.min(base + index, base + PANEL_LAYER_MAX_Z_INDEX);
}
