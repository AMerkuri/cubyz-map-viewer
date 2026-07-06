import * as THREE from "three";

import type { CursorHoverInfo, LoadedVoxelTile } from "./types.js";

const TOUCH_HOLD_DELAY_MS = 500;
const TOUCH_HOLD_MOVE_THRESHOLD_PX = 12;
const TOUCH_HOLD_LINGER_MS = 1000;

interface CursorInteractionHandlers {
  clearCursorRefreshTimer: () => void;
  clearTouchLingerTimer: () => void;
  didTouchHoldActivate: (pointerId: number) => boolean;
  resetCursorInteractionState: () => void;
  scheduleCursorTooltipRefresh: () => void;
  updateCursorTooltip: () => void;
  onPointerMove: (e: PointerEvent) => void;
  onPointerDown: (e: PointerEvent) => void;
  onPointerUp: (e: PointerEvent) => void;
  onPointerCancel: (e: PointerEvent) => void;
  onPointerLeave: (e: PointerEvent) => void;
}

export function createCursorInteractionHandlers(args: {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  showTerrainUnderlayRef: { current: boolean };
  showChunkBordersRef: { current: boolean };
  debugEnabledRef: { current: boolean };
  terrainGroupRef: { current: THREE.Group | null };
  voxelGroupRef: { current: THREE.Group | null };
  loadedVoxelsRef: { current: Map<string, LoadedVoxelTile> };
  getBlockIdForPaletteIndex: (paletteIndex: number) => string | undefined;
  keysHeldRef: { current: Set<string> };
  onCursorMoveRef: { current: (info: CursorHoverInfo | null) => void };
}): CursorInteractionHandlers {
  const {
    renderer,
    camera,
    showTerrainUnderlayRef,
    showChunkBordersRef,
    debugEnabledRef,
    terrainGroupRef,
    voxelGroupRef,
    loadedVoxelsRef,
    getBlockIdForPaletteIndex,
    keysHeldRef,
    onCursorMoveRef,
  } = args;

  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const objectWorldPosition = new THREE.Vector3();
  const hoverState = { active: false, clientX: 0, clientY: 0 };
  let isPointerInteracting = false;
  let cursorRefreshTimer: number | null = null;
  let touchHoldTimer: number | null = null;
  let touchHideTimer: number | null = null;
  let touchPointerId: number | null = null;
  let touchHoldActive = false;
  let touchStartClientX = 0;
  let touchStartClientY = 0;

  function reportIntersection(
    intersection: THREE.Intersection,
    isTerrain: boolean,
    voxelChunkLod?: number,
    voxelRegion?: [number, number],
    blockId?: string,
  ) {
    const point = intersection.point;
    const terrainOffsetZ = isTerrain
      ? intersection.object.getWorldPosition(objectWorldPosition).z
      : 0;
    const pos: [number, number, number] = [
      Math.round(point.x),
      Math.round(point.y),
      Math.round(point.z - terrainOffsetZ),
    ];
    onCursorMoveRef.current({ pos, blockId, voxelChunkLod, voxelRegion });
  }

  function findHoveredVoxelTile(
    intersection: THREE.Intersection,
  ): LoadedVoxelTile | undefined {
    let node: THREE.Object3D | null = intersection.object;
    while (node) {
      const voxelKey = node.userData.voxelKey as string | undefined;
      if (voxelKey) {
        return loadedVoxelsRef.current.get(voxelKey);
      }
      node = node.parent;
    }

    return undefined;
  }

  function resolveVoxelBlockId(
    intersection: THREE.Intersection,
    tile: LoadedVoxelTile | undefined,
  ): string | undefined {
    if (!tile || intersection.faceIndex == null) return undefined;
    const subMesh = [...tile.subMeshes, ...tile.transparentSubMeshes].find(
      (candidate) => candidate.mesh === intersection.object,
    );
    if (!subMesh) return undefined;

    const paletteIndex = subMesh.trianglePaletteIndices[intersection.faceIndex];
    if (paletteIndex === undefined || !Number.isSafeInteger(paletteIndex)) {
      return undefined;
    }
    return getBlockIdForPaletteIndex(paletteIndex);
  }

  function isObjectEffectivelyVisible(object: THREE.Object3D): boolean {
    let node: THREE.Object3D | null = object;
    while (node) {
      if (!node.visible) return false;
      node = node.parent;
    }
    return true;
  }

  function selectBestVoxelIntersection(
    intersections: THREE.Intersection[],
  ): { intersection: THREE.Intersection; tile?: LoadedVoxelTile } | null {
    let best: {
      intersection: THREE.Intersection;
      tile?: LoadedVoxelTile;
    } | null = null;

    for (const intersection of intersections) {
      if (!isObjectEffectivelyVisible(intersection.object)) continue;
      const tile = findHoveredVoxelTile(intersection);
      if (!best) {
        best = { intersection, tile };
        continue;
      }

      const distDelta = Math.abs(
        intersection.distance - best.intersection.distance,
      );
      if (distDelta <= 0.5) {
        const bestLod = best.tile?.lod ?? Number.POSITIVE_INFINITY;
        const nextLod = tile?.lod ?? Number.POSITIVE_INFINITY;
        if (nextLod < bestLod) {
          best = { intersection, tile };
        }
        continue;
      }

      if (intersection.distance < best.intersection.distance) {
        best = { intersection, tile };
      }
    }

    return best;
  }

  function clearCursorRefreshTimer() {
    if (cursorRefreshTimer === null) return;
    window.clearTimeout(cursorRefreshTimer);
    cursorRefreshTimer = null;
  }

  function clearTouchTimers() {
    if (touchHoldTimer !== null) {
      window.clearTimeout(touchHoldTimer);
      touchHoldTimer = null;
    }
    if (touchHideTimer !== null) {
      window.clearTimeout(touchHideTimer);
      touchHideTimer = null;
    }
  }

  function resetTouchState() {
    touchPointerId = null;
    touchHoldActive = false;
  }

  function resetCursorInteractionState() {
    clearCursorRefreshTimer();
    clearTouchTimers();
    hoverState.active = false;
    isPointerInteracting = false;
    resetTouchState();
    onCursorMoveRef.current(null);
  }

  function clearTouchHideTimer() {
    if (touchHideTimer === null) return;
    window.clearTimeout(touchHideTimer);
    touchHideTimer = null;
  }

  function clearTouchLingerTimer() {
    clearTouchHideTimer();
  }

  function clearTouchHoldTimer() {
    if (touchHoldTimer === null) return;
    window.clearTimeout(touchHoldTimer);
    touchHoldTimer = null;
  }

  function didTouchHoldActivate(pointerId: number): boolean {
    return touchPointerId === pointerId && touchHoldActive;
  }

  function isTouchMoveBeyondThreshold(clientX: number, clientY: number) {
    return (
      Math.abs(clientX - touchStartClientX) > TOUCH_HOLD_MOVE_THRESHOLD_PX ||
      Math.abs(clientY - touchStartClientY) > TOUCH_HOLD_MOVE_THRESHOLD_PX
    );
  }

  function scheduleTouchHold(pointerId: number) {
    clearTouchHoldTimer();
    touchHoldTimer = window.setTimeout(() => {
      touchHoldTimer = null;
      if (
        !hoverState.active ||
        touchPointerId !== pointerId ||
        keysHeldRef.current.size > 0
      )
        return;
      touchHoldActive = true;
      updateCursorTooltip(true);
    }, TOUCH_HOLD_DELAY_MS);
  }

  function scheduleTouchHide() {
    clearTouchHideTimer();
    touchHideTimer = window.setTimeout(() => {
      touchHideTimer = null;
      onCursorMoveRef.current(null);
    }, TOUCH_HOLD_LINGER_MS);
  }

  function cancelTouchInspection() {
    clearCursorRefreshTimer();
    clearTouchTimers();
    hoverState.active = false;
    resetTouchState();
    onCursorMoveRef.current(null);
  }

  function updateCursorTooltip(allowWhileInteracting = false) {
    if (!hoverState.active) return;
    if (!allowWhileInteracting && isPointerInteracting) return;
    if (keysHeldRef.current.size > 0) return;

    const terrainGroup = terrainGroupRef.current;
    const terrainVisible = showTerrainUnderlayRef.current;

    const voxelTargets: THREE.Object3D[] = [];
    if (voxelGroupRef.current) {
      voxelTargets.push(voxelGroupRef.current);
    }

    const terrainTargets: THREE.Object3D[] = [];
    if (terrainVisible && terrainGroup) {
      terrainTargets.push(terrainGroup);
    }

    if (voxelTargets.length === 0 && terrainTargets.length === 0) {
      onCursorMoveRef.current(null);
      return;
    }

    const rect = renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      onCursorMoveRef.current(null);
      return;
    }

    pointerNdc.x = ((hoverState.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((hoverState.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNdc, camera);

    if (voxelTargets.length > 0) {
      const voxelIntersections = raycaster.intersectObjects(voxelTargets, true);
      const voxelHit = selectBestVoxelIntersection(voxelIntersections);
      if (voxelHit) {
        const debugTile =
          debugEnabledRef.current && showChunkBordersRef.current
            ? voxelHit.tile
            : undefined;
        reportIntersection(
          voxelHit.intersection,
          false,
          debugTile?.lod,
          debugTile ? [debugTile.regionX, debugTile.regionY] : undefined,
          resolveVoxelBlockId(voxelHit.intersection, voxelHit.tile),
        );
        return;
      }
    }

    if (terrainTargets.length === 0) {
      onCursorMoveRef.current(null);
      return;
    }

    const terrainIntersections = raycaster.intersectObjects(
      terrainTargets,
      true,
    );
    if (terrainIntersections.length === 0) {
      onCursorMoveRef.current(null);
      return;
    }

    reportIntersection(terrainIntersections[0], true);
  }

  function scheduleCursorTooltipRefresh() {
    if (
      !hoverState.active ||
      isPointerInteracting ||
      keysHeldRef.current.size > 0
    )
      return;
    clearCursorRefreshTimer();
    cursorRefreshTimer = window.setTimeout(() => {
      cursorRefreshTimer = null;
      if (
        !hoverState.active ||
        isPointerInteracting ||
        keysHeldRef.current.size > 0
      )
        return;
      updateCursorTooltip();
    }, 50);
  }

  function onPointerMove(e: PointerEvent) {
    if (e.pointerType === "touch") {
      if (touchPointerId !== e.pointerId) return;
      hoverState.active = true;
      hoverState.clientX = e.clientX;
      hoverState.clientY = e.clientY;
      if (isTouchMoveBeyondThreshold(e.clientX, e.clientY)) {
        cancelTouchInspection();
        return;
      }
      if (touchHoldActive) {
        updateCursorTooltip(true);
      }
      return;
    }

    hoverState.active = true;
    hoverState.clientX = e.clientX;
    hoverState.clientY = e.clientY;
    clearTouchLingerTimer();
    clearCursorRefreshTimer();
    if (isPointerInteracting || keysHeldRef.current.size > 0) return;
    updateCursorTooltip();
  }

  function onPointerDown(e: PointerEvent) {
    clearTouchTimers();
    isPointerInteracting = true;
    clearCursorRefreshTimer();
    hoverState.active = true;
    hoverState.clientX = e.clientX;
    hoverState.clientY = e.clientY;

    if (e.pointerType === "touch") {
      if (!e.isPrimary) {
        cancelTouchInspection();
        return;
      }

      touchPointerId = e.pointerId;
      touchStartClientX = e.clientX;
      touchStartClientY = e.clientY;
      touchHoldActive = false;
      scheduleTouchHold(e.pointerId);
      onCursorMoveRef.current(null);
      return;
    }

    onCursorMoveRef.current(null);
  }

  function onPointerUp(e: PointerEvent) {
    if (e.pointerType === "touch") {
      if (touchPointerId !== e.pointerId) return;

      isPointerInteracting = false;

      const wasTouchHoldActive = touchHoldActive;
      clearCursorRefreshTimer();
      clearTouchHoldTimer();
      resetTouchState();
      hoverState.active = false;

      if (wasTouchHoldActive) {
        scheduleTouchHide();
      } else {
        onCursorMoveRef.current(null);
      }
      return;
    }

    isPointerInteracting = false;
    clearCursorRefreshTimer();
    scheduleCursorTooltipRefresh();
  }

  function onPointerCancel(e: PointerEvent) {
    if (e.pointerType === "touch" && touchPointerId !== e.pointerId) return;

    isPointerInteracting = false;

    clearTouchTimers();
    cancelTouchInspection();
  }

  function onPointerLeave(e: PointerEvent) {
    if (e.pointerType === "touch") {
      if (touchPointerId !== e.pointerId) return;
      isPointerInteracting = false;
      if (e.buttons === 0) {
        const wasTouchHoldActive = touchHoldActive;
        clearTouchHoldTimer();
        resetTouchState();
        if (wasTouchHoldActive) {
          scheduleTouchHide();
        } else {
          onCursorMoveRef.current(null);
        }
        return;
      }

      clearTouchTimers();
      cancelTouchInspection();
      return;
    }

    hoverState.active = false;
    isPointerInteracting = false;
    clearTouchLingerTimer();
    clearCursorRefreshTimer();
    onCursorMoveRef.current(null);
  }

  return {
    clearCursorRefreshTimer,
    clearTouchLingerTimer,
    didTouchHoldActivate,
    resetCursorInteractionState,
    scheduleCursorTooltipRefresh,
    updateCursorTooltip,
    onPointerMove,
    onPointerDown,
    onPointerUp,
    onPointerCancel,
    onPointerLeave,
  };
}
