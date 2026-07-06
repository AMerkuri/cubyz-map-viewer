import type {
  InitialCameraState,
  ShareLocationState,
} from "../types/world-view.js";

export function readInitialCameraState(): InitialCameraState | null {
  const p = new URLSearchParams(window.location.search);
  const x = parseFloat(p.get("x") ?? "");
  const y = parseFloat(p.get("y") ?? "");
  const z = parseFloat(p.get("z") ?? "");
  const zoom = parseFloat(p.get("zoom") ?? "");
  const theta = parseFloat(p.get("theta") ?? "");
  const phi = parseFloat(p.get("phi") ?? "");
  if (
    !Number.isNaN(x) &&
    !Number.isNaN(y) &&
    !Number.isNaN(z) &&
    !Number.isNaN(zoom) &&
    !Number.isNaN(theta) &&
    !Number.isNaN(phi)
  ) {
    return {
      pos: [x, y, z],
      zoom,
      theta,
      phi,
      focusMode: p.get("focus") === "exact" ? "exact" : "map-compatible",
    };
  }
  return null;
}

export function createShareLocationUrl(state: ShareLocationState): string {
  const p = new URLSearchParams();
  p.set("x", String(state.pos[0]));
  p.set("y", String(state.pos[1]));
  p.set("z", String(state.pos[2]));
  p.set("zoom", String(state.zoom));
  p.set("theta", String(state.theta));
  p.set("phi", String(state.phi));
  p.set("focus", "exact");

  return `${window.location.origin}${window.location.pathname}?${p.toString()}`;
}
