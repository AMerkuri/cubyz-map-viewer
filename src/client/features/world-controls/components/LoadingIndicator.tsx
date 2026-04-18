import { useEffect, useState } from "react";
import { uiTheme } from "../../../lib/ui-theme.js";

export function LoadingIndicator({
  visible,
  compact = false,
}: {
  visible: boolean;
  compact?: boolean;
}) {
  const [mounted, setMounted] = useState(visible);
  const [shown, setShown] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      const frame = window.requestAnimationFrame(() => {
        setShown(true);
      });
      return () => {
        window.cancelAnimationFrame(frame);
      };
    }

    setShown(false);
    const timeout = window.setTimeout(() => {
      setMounted(false);
    }, 180);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [visible]);

  if (!mounted) return null;

  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        left: compact ? 12 : undefined,
        top: compact ? 12 : undefined,
        right: compact ? undefined : 12,
        bottom: compact ? undefined : 12,
        zIndex: 1000,
        pointerEvents: "none",
        opacity: shown ? 1 : 0,
        transition: "opacity 180ms ease",
        willChange: "opacity",
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: 999,
          border: `3px solid color-mix(in srgb, ${uiTheme.accent.spinnerTop} 16%, transparent)`,
          borderTopColor: uiTheme.accent.spinnerTop,
          borderRightColor: uiTheme.accent.spinnerRight,
          animation: "cubyz-half-spin 0.8s linear infinite",
        }}
      />
    </div>
  );
}
