import { useCallback, useEffect, useRef, useState } from "react";
import { createShareLocationUrl } from "../../lib/world-view-url-state.js";
import type { ShareLocationState } from "../../types/world-view.js";

export function useWorldViewShareLocation() {
  const shareLocationRef = useRef<ShareLocationState | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [currentZoom, setCurrentZoom] = useState<number | null>(null);

  const handleShareStateChange = useCallback((next: ShareLocationState) => {
    shareLocationRef.current = next;
    setCurrentZoom(next.zoom);
  }, []);

  const handleShareLocation = useCallback(async () => {
    const shareState = shareLocationRef.current;
    if (!shareState) return;

    const url = createShareLocationUrl(shareState);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const input = document.createElement("textarea");
        input.value = url;
        input.setAttribute("readonly", "true");
        input.style.position = "fixed";
        input.style.left = "-9999px";
        document.body.appendChild(input);
        input.select();
        const copied = document.execCommand("copy");
        document.body.removeChild(input);
        if (!copied) throw new Error("copy command failed");
      }
      setShareCopied(true);
    } catch {
      setShareCopied(false);
    }
  }, []);

  useEffect(() => {
    if (!shareCopied) return;
    const timer = window.setTimeout(() => {
      setShareCopied(false);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [shareCopied]);

  return {
    currentZoom,
    shareCopied,
    handleShareLocation,
    handleShareStateChange,
  };
}
