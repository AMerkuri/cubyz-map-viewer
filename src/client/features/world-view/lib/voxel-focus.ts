import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { clampDistanceToLodRange } from "./lod-utils.js";
import type { VoxelFocusState } from "./types.js";

export function resolveVoxelLodFocus(args: {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  voxelGroup: THREE.Group | null;
  state: VoxelFocusState;
  stickyMs: number;
  smoothAlpha: number;
  activeFocusLod: number;
  voxelLodThresholds: { maxDist: number; lod: number }[];
}): {
  point: THREE.Vector3;
  zoomDist: number;
} {
  const {
    camera,
    controls,
    voxelGroup,
    state,
    stickyMs,
    smoothAlpha,
    activeFocusLod,
    voxelLodThresholds,
  } = args;
  const now = performance.now();
  const fallbackPoint = controls.target.clone();
  const fallbackZoomDist = camera.position.distanceTo(controls.target);

  let rawPoint = fallbackPoint;
  let rawZoomDist = fallbackZoomDist;
  let hadRayHit = false;

  if (voxelGroup && voxelGroup.children.length > 0) {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const intersections = raycaster.intersectObjects(
      voxelGroup.children,
      false,
    );
    if (intersections.length > 0) {
      hadRayHit = true;
      rawPoint = intersections[0].point.clone();
      const hitZoomDist = camera.position.distanceTo(intersections[0].point);
      rawZoomDist = Math.min(fallbackZoomDist, hitZoomDist);
      state.lastHitAt = now;
    }
  }

  if (!hadRayHit && state.initialized && now - state.lastHitAt <= stickyMs) {
    rawPoint = state.point.clone();
    rawZoomDist = clampDistanceToLodRange(
      state.zoomDist,
      activeFocusLod,
      voxelLodThresholds,
    );
  }

  if (!state.initialized) {
    state.initialized = true;
    state.point.copy(rawPoint);
    state.zoomDist = rawZoomDist;
    return {
      point: rawPoint,
      zoomDist: rawZoomDist,
    };
  }

  state.point.lerp(rawPoint, smoothAlpha);
  state.zoomDist = THREE.MathUtils.lerp(
    state.zoomDist,
    rawZoomDist,
    smoothAlpha,
  );

  return {
    point: state.point.clone(),
    zoomDist: state.zoomDist,
  };
}
