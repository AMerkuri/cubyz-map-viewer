import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { LOD_LEVELS } from "./constants.js";
import { getLodForDistanceWithHysteresis } from "./lod-utils.js";
import type { PendingVoxelFetchRequest } from "./types.js";

export function checkAndUpdateLod(args: {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  showTerrainUnderlay: boolean;
  voxelLastCameraSampleRef: {
    current: { camera: THREE.Vector3; target: THREE.Vector3 } | null;
  };
  voxelLastMotionAtRef: { current: number };
  pendingVoxelDetailRequestsRef: {
    current: Map<string, PendingVoxelFetchRequest>;
  };
  committedVoxelDetailRequestsRef: {
    current: Map<string, PendingVoxelFetchRequest>;
  };
  syncVoxelRequests: (requests: Map<string, PendingVoxelFetchRequest>) => void;
  activeFocusLodRef: { current: number };
  syncTerrainLod: (target: THREE.Vector3, camDist: number) => void;
  updateTerrainVisibility: (target: THREE.Vector3, camDist: number) => void;
  terrainVisibilityDirtyRef: { current: boolean };
  resolveVoxelLodFocus: (
    camera: THREE.PerspectiveCamera,
    controls: OrbitControls,
    cameraForward: THREE.Vector3,
  ) => { point: THREE.Vector3; zoomDist: number };
  voxelLodThresholds: { maxDist: number; lod: number }[];
  minRenderedVoxelLod: number;
  voxelLodHysteresisRatio: number;
  updateVoxelLod: (
    focusLod: number,
    cameraPosition: THREE.Vector3,
    cameraForward: THREE.Vector3,
  ) => void;
  debugLabelsDirtyRef: { current: boolean };
  biomeLabelsDirtyRef: { current: boolean };
  refreshDebugLabels: () => void;
  refreshBiomeLabels: (
    target: THREE.Vector3,
    camDist: number,
  ) => Promise<void> | void;
  onShareStateChange: (state: {
    pos: [number, number, number];
    zoom: number;
    theta: number;
    phi: number;
  }) => void;
}): void {
  const {
    camera,
    controls,
    showTerrainUnderlay,
    voxelLastCameraSampleRef,
    voxelLastMotionAtRef,
    pendingVoxelDetailRequestsRef,
    committedVoxelDetailRequestsRef,
    syncVoxelRequests,
    activeFocusLodRef,
    syncTerrainLod,
    updateTerrainVisibility,
    terrainVisibilityDirtyRef,
    resolveVoxelLodFocus,
    voxelLodThresholds,
    minRenderedVoxelLod,
    voxelLodHysteresisRatio,
    updateVoxelLod,
    debugLabelsDirtyRef,
    biomeLabelsDirtyRef,
    refreshDebugLabels,
    refreshBiomeLabels,
    onShareStateChange,
  } = args;
  const target = controls.target;
  const camDist = camera.position.distanceTo(target);
  const now = performance.now();

  const lastCameraSample = voxelLastCameraSampleRef.current;
  if (
    !lastCameraSample ||
    lastCameraSample.camera.distanceToSquared(camera.position) > 1 ||
    lastCameraSample.target.distanceToSquared(target) > 1
  ) {
    voxelLastMotionAtRef.current = now;
    if (lastCameraSample) {
      lastCameraSample.camera.copy(camera.position);
      lastCameraSample.target.copy(target);
    } else {
      voxelLastCameraSampleRef.current = {
        camera: camera.position.clone(),
        target: target.clone(),
      };
    }
  }

  void pendingVoxelDetailRequestsRef;
  void committedVoxelDetailRequestsRef;
  void syncVoxelRequests;

  if (showTerrainUnderlay) {
    syncTerrainLod(target, camDist);
  } else if (terrainVisibilityDirtyRef.current) {
    updateTerrainVisibility(target, camDist);
    terrainVisibilityDirtyRef.current = false;
  }

  const cameraForward = target.clone().sub(camera.position);
  cameraForward.z = 0;
  const forwardLenSq = cameraForward.lengthSq();
  if (forwardLenSq > 1e-6) {
    cameraForward.multiplyScalar(1 / Math.sqrt(forwardLenSq));
  } else {
    cameraForward.set(0, 0, 0);
  }

  const focus = resolveVoxelLodFocus(camera, controls, cameraForward);
  const unclampedFocusLod = getLodForDistanceWithHysteresis(
    focus.zoomDist,
    activeFocusLodRef.current,
    voxelLodThresholds,
    voxelLodHysteresisRatio,
  );
  const focusLod =
    LOD_LEVELS[
      Math.max(
        LOD_LEVELS.indexOf(unclampedFocusLod),
        LOD_LEVELS.indexOf(minRenderedVoxelLod),
      )
    ];
  activeFocusLodRef.current = focusLod;
  updateVoxelLod(focusLod, camera.position, cameraForward);

  if (debugLabelsDirtyRef.current) {
    debugLabelsDirtyRef.current = false;
    refreshDebugLabels();
  }
  if (biomeLabelsDirtyRef.current) {
    biomeLabelsDirtyRef.current = false;
    void refreshBiomeLabels(target, camDist);
  }

  const offset = camera.position.clone().sub(target);
  const r = offset.length();
  if (r >= 0.001) {
    onShareStateChange({
      pos: [Math.round(target.x), Math.round(target.y), Math.round(target.z)],
      zoom: Math.round(r),
      theta: Math.round(
        THREE.MathUtils.radToDeg(Math.atan2(offset.y, offset.x)),
      ),
      phi: Math.round(
        THREE.MathUtils.radToDeg(
          Math.acos(Math.max(-1, Math.min(1, offset.z / r))),
        ),
      ),
    });
  }
}
