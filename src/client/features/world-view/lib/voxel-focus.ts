import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";

import {
  applyBehindCameraDistanceBias,
  clampDistanceToLodRange,
} from "./lod-utils.js";
import type { LoadedVoxelTile, VoxelFocusState } from "./types.js";
import { regionWorldSize } from "./utils.js";

export function resolveVoxelLodFocus(args: {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  voxelGroup: THREE.Group | null;
  loadedVoxels: Map<string, LoadedVoxelTile>;
  cameraForward: THREE.Vector3;
  referenceSurfaceZ: number;
  voxelBehindCameraDotStart: number;
  voxelBehindCameraMaxMultiplier: number;
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
    loadedVoxels,
    cameraForward,
    referenceSurfaceZ,
    voxelBehindCameraDotStart,
    voxelBehindCameraMaxMultiplier,
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
  let sampled = false;

  const nearestEntry = findNearestLoadedVoxelFocus(
    loadedVoxels,
    camera.position,
    cameraForward,
    voxelBehindCameraDotStart,
    voxelBehindCameraMaxMultiplier,
  );
  if (nearestEntry) {
    sampled = true;
    rawPoint.copy(nearestEntry.point);
    rawZoomDist = nearestEntry.distance;
    state.lastSampleAt = now;
  }

  if (!sampled && voxelGroup && voxelGroup.children.length > 0) {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const intersections = raycaster.intersectObjects(
      voxelGroup.children,
      false,
    );
    if (intersections.length > 0) {
      sampled = true;
      rawPoint = intersections[0].point.clone();
      rawZoomDist = camera.position.distanceTo(intersections[0].point);
      state.lastSampleAt = now;
    }
  }

  if (!sampled && state.initialized && now - state.lastSampleAt <= stickyMs) {
    rawPoint = state.point.clone();
    rawZoomDist = clampDistanceToLodRange(
      state.zoomDist,
      activeFocusLod,
      voxelLodThresholds,
    );
  }

  if (!sampled && !state.initialized && Number.isFinite(referenceSurfaceZ)) {
    rawZoomDist = Math.max(0, camera.position.z - referenceSurfaceZ);
  }

  if (sampled && Number.isFinite(referenceSurfaceZ)) {
    rawZoomDist = Math.max(
      rawZoomDist,
      Math.max(0, camera.position.z - referenceSurfaceZ),
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

function findNearestLoadedVoxelFocus(
  loadedVoxels: Map<string, LoadedVoxelTile>,
  cameraPosition: THREE.Vector3,
  cameraForward: THREE.Vector3,
  voxelBehindCameraDotStart: number,
  voxelBehindCameraMaxMultiplier: number,
): { point: THREE.Vector3; distance: number } | null {
  let best: {
    point: THREE.Vector3;
    distance: number;
  } | null = null;
  const hasForward = cameraForward.lengthSq() > 1e-6;

  for (const tile of loadedVoxels.values()) {
    const candidate = getLoadedTileFocusPoint(tile, cameraPosition);
    const distance = candidate.distanceTo(cameraPosition);
    if (!Number.isFinite(distance)) continue;

    let weightedDistance = distance;
    if (hasForward) {
      const toCandidateX = candidate.x - cameraPosition.x;
      const toCandidateY = candidate.y - cameraPosition.y;
      const horizontalLen = Math.hypot(toCandidateX, toCandidateY);
      if (horizontalLen > 1e-6) {
        const dot =
          (cameraForward.x * toCandidateX + cameraForward.y * toCandidateY) /
          horizontalLen;
        if (dot < voxelBehindCameraDotStart) {
          weightedDistance = applyBehindCameraDistanceBias({
            effectiveDist: weightedDistance,
            objectWorldSize: regionWorldSize(tile.lod),
            dot,
            dotStart: voxelBehindCameraDotStart,
            maxMultiplier: voxelBehindCameraMaxMultiplier,
          });
        }
      }
    }

    if (!best || weightedDistance < best.distance) {
      best = { point: candidate, distance: weightedDistance };
    }
  }

  return best;
}

function getLoadedTileFocusPoint(
  tile: LoadedVoxelTile,
  cameraPosition: THREE.Vector3,
): THREE.Vector3 {
  const size = regionWorldSize(tile.lod);
  const minZ = Math.min(tile.minZ, tile.maxZ);
  const maxZ = Math.max(tile.minZ, tile.maxZ);
  return new THREE.Vector3(
    clamp(cameraPosition.x, tile.regionX, tile.regionX + size),
    clamp(cameraPosition.y, tile.regionY, tile.regionY + size),
    Number.isFinite(minZ) && Number.isFinite(maxZ)
      ? clamp(cameraPosition.z, minZ, maxZ)
      : cameraPosition.z,
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
