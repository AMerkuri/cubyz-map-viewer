import * as THREE from "three";

const TOUCH_HOLD_DELAY_MS = 500;
const TOUCH_HOLD_MOVE_THRESHOLD_PX = 12;
const TOUCH_HOLD_LINGER_MS = 1000;

export interface CursorInteractionHandlers {
  clearCursorRefreshTimer: () => void;
  clearTouchLingerTimer: () => void;
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
  modeRef: { current: "terrain" | "voxel" };
  showTerrainRef: { current: boolean };
  showVoxelTerrainRef: { current: boolean };
  terrainGroupRef: { current: THREE.Group | null };
  voxelGroupRef: { current: THREE.Group | null };
  keysHeldRef: { current: Set<string> };
  onCursorMoveRef: { current: (pos: [number, number, number] | null) => void };
}): CursorInteractionHandlers {
  const {
    renderer,
    camera,
    modeRef,
    showTerrainRef,
    showVoxelTerrainRef,
    terrainGroupRef,
    voxelGroupRef,
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
  ) {
    const point = intersection.point;
    const terrainOffsetZ = isTerrain
      ? intersection.object.getWorldPosition(objectWorldPosition).z
      : 0;
    onCursorMoveRef.current([
      Math.round(point.x),
      Math.round(point.y),
      Math.round(point.z - terrainOffsetZ),
    ]);
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
    const terrainVisible =
      modeRef.current === "terrain"
        ? showTerrainRef.current
        : showVoxelTerrainRef.current;

    const voxelTargets: THREE.Object3D[] = [];
    if (modeRef.current === "voxel" && voxelGroupRef.current) {
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
      if (voxelIntersections.length > 0) {
        reportIntersection(voxelIntersections[0], false);
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
