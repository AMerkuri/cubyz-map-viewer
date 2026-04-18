import { useEffect, useState } from "react";

const COMPACT_VIEWPORT_MAX_WIDTH_PX = 768;
const COMPACT_VIEWPORT_MAX_HEIGHT_PX = 720;

function detectCompactViewport(): boolean {
  if (typeof window === "undefined") return false;

  return (
    window.innerWidth < COMPACT_VIEWPORT_MAX_WIDTH_PX ||
    window.innerHeight <= COMPACT_VIEWPORT_MAX_HEIGHT_PX
  );
}

export function useCompactViewport(): boolean {
  const [compact, setCompact] = useState(() => detectCompactViewport());

  useEffect(() => {
    const updateCompact = () => {
      setCompact(detectCompactViewport());
    };

    updateCompact();
    window.addEventListener("resize", updateCompact);
    window.addEventListener("orientationchange", updateCompact);
    return () => {
      window.removeEventListener("resize", updateCompact);
      window.removeEventListener("orientationchange", updateCompact);
    };
  }, []);

  return compact;
}
