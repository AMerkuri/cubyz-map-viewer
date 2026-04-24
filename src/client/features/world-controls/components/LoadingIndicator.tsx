import { type CSSProperties, useEffect, useRef, useState } from "react";
import { uiTheme } from "../../../lib/ui-theme.js";

const DESKTOP_SEGMENTS = Array.from({ length: 24 }, (_, index) => index);
const COMPACT_CUBE_FACES = [
  "front",
  "back",
  "right",
  "left",
  "top",
  "bottom",
] as const;

const LOADING_LINGER_MS = 1000;
const FADE_MS = 180;

export function LoadingIndicator({
  visible,
  loadingChunks,
  loadedChunks,
  compact = false,
}: {
  visible: boolean;
  loadingChunks: number;
  loadedChunks: number;
  compact?: boolean;
}) {
  const [mounted, setMounted] = useState(visible);
  const [shown, setShown] = useState(visible);
  const hideTimerRef = useRef<number | null>(null);
  const unmountTimerRef = useRef<number | null>(null);
  const showFrameRef = useRef<number | null>(null);
  const totalChunks = loadingChunks + loadedChunks;
  const progress = totalChunks > 0 ? loadedChunks / totalChunks : 0;

  useEffect(() => {
    if (!visible) {
      if (unmountTimerRef.current !== null) {
        window.clearTimeout(unmountTimerRef.current);
        unmountTimerRef.current = null;
      }
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
      if (showFrameRef.current !== null) {
        window.cancelAnimationFrame(showFrameRef.current);
        showFrameRef.current = null;
      }
      hideTimerRef.current = window.setTimeout(() => {
        setShown(false);
        unmountTimerRef.current = window.setTimeout(() => {
          setMounted(false);
          unmountTimerRef.current = null;
        }, FADE_MS);
        hideTimerRef.current = null;
      }, LOADING_LINGER_MS);
      return;
    }

    if (unmountTimerRef.current !== null) {
      window.clearTimeout(unmountTimerRef.current);
      unmountTimerRef.current = null;
    }
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    if (showFrameRef.current !== null) {
      window.cancelAnimationFrame(showFrameRef.current);
      showFrameRef.current = null;
    }

    setMounted(true);
    showFrameRef.current = window.requestAnimationFrame(() => {
      showFrameRef.current = null;
      setShown(true);
    });

    return () => {
      if (showFrameRef.current !== null) {
        window.cancelAnimationFrame(showFrameRef.current);
        showFrameRef.current = null;
      }
    };
  }, [visible]);

  if (!mounted) return null;

  const outerStyle: CSSProperties = {
    position: "absolute",
    left: compact ? 18 : undefined,
    top: compact ? 18 : undefined,
    right: compact ? undefined : 12,
    bottom: compact ? undefined : 12,
    zIndex: 1000,
    pointerEvents: "none",
    opacity: shown ? 1 : 0,
    transition: `opacity ${FADE_MS}ms ease`,
    willChange: "opacity",
    backdropFilter: "blur(5px)",
  };

  return (
    <div aria-hidden="true" style={outerStyle}>
      {compact ? (
        <CompactCube />
      ) : (
        <DesktopBar
          progress={progress}
          loadedChunks={loadedChunks}
          totalChunks={totalChunks}
        />
      )}
    </div>
  );
}

function DesktopBar({
  progress,
  loadedChunks,
  totalChunks,
}: {
  progress: number;
  loadedChunks: number;
  totalChunks: number;
}) {
  return (
    <div
      style={{
        display: "grid",
        gap: 8,
        minWidth: 260,
        padding: "10px 12px",
        background: uiTheme.panel.background,
        border: `2px solid ${uiTheme.panel.border}`,
        boxShadow: uiTheme.panel.shadow,
        imageRendering: "pixelated",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <span
          style={{
            color: uiTheme.accent.title,
            fontSize: 13,
            fontWeight: 400,
            textTransform: "uppercase",
            textShadow: "2px 2px 0 rgba(0,0,0,0.8)",
            letterSpacing: "0.04em",
          }}
        >
          Loading Chunks
        </span>
        <span
          style={{
            color: uiTheme.text.secondary,
            fontSize: 12,
            fontWeight: 400,
            whiteSpace: "nowrap",
            textShadow: "1px 1px 0 rgba(0,0,0,0.7)",
          }}
        >
          Loaded chunks: {loadedChunks} / {totalChunks}
        </span>
      </div>

      <div
        style={{
          padding: 4,
          background: uiTheme.panel.buttonBackgroundMuted,
          border: `2px solid ${uiTheme.panel.buttonBorderMuted}`,
          boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.28)",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${DESKTOP_SEGMENTS.length}, minmax(0, 1fr))`,
            gap: 2,
          }}
        >
          {DESKTOP_SEGMENTS.map((segment, index) => {
            const filled =
              index < Math.round(progress * DESKTOP_SEGMENTS.length);
            return (
              <div
                key={segment}
                style={{
                  height: 12,
                  border: `1px solid ${
                    filled
                      ? uiTheme.accent.border
                      : uiTheme.panel.buttonBorderMuted
                  }`,
                  background: filled
                    ? uiTheme.accent.surfaceActive
                    : uiTheme.panel.buttonBackground,
                  boxShadow: filled
                    ? "inset 0 0 0 1px rgba(255,255,255,0.08)"
                    : "inset 0 0 0 1px rgba(0,0,0,0.18)",
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CompactCube() {
  return (
    <div
      style={{
        display: "grid",
        justifyItems: "start",
        gap: 6,
        perspective: 240,
      }}
    >
      <div
        style={{
          position: "relative",
          width: 32,
          height: 32,
          transformStyle: "preserve-3d",
          animation: "cubyz-cube-spin 1.4s linear infinite",
        }}
      >
        {COMPACT_CUBE_FACES.map((face) => (
          <CubeFace key={face} face={face} />
        ))}
      </div>
      <style>{`@keyframes cubyz-cube-spin { from { transform: rotateX(-28deg) rotateY(0deg); } to { transform: rotateX(-28deg) rotateY(360deg); } }`}</style>
    </div>
  );
}

function CubeFace({ face }: { face: (typeof COMPACT_CUBE_FACES)[number] }) {
  const base: CSSProperties = {
    position: "absolute",
    inset: 0,
    background: "#583e2d",
    boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.6)`,
    outline: "1px solid transparent",
    backfaceVisibility: "hidden",
    willChange: "transform",
  };

  const transforms: Record<(typeof COMPACT_CUBE_FACES)[number], string> = {
    front: "translateZ(16px)",
    back: "rotateY(180deg) translateZ(16px)",
    right: "rotateY(90deg) translateZ(16px)",
    left: "rotateY(-90deg) translateZ(16px)",
    top: "rotateX(90deg) translateZ(16px)",
    bottom: "rotateX(-90deg) translateZ(16px)",
  };

  return <div style={{ ...base, transform: transforms[face] }} />;
}
