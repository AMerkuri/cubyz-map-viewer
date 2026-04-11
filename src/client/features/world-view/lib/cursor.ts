import * as THREE from "three";

export interface CursorInteractionHandlers {
  clearCursorRefreshTimer: () => void;
  scheduleCursorTooltipRefresh: () => void;
  updateCursorTooltip: () => void;
  onPointerMove: (e: PointerEvent) => void;
  onPointerDown: () => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onPointerLeave: () => void;
}

export function createCursorInteractionHandlers(args: {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  modeRef: { current: "terrain" | "voxel" };
  showTerrainRef: { current: boolean };
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
    terrainGroupRef,
    voxelGroupRef,
    keysHeldRef,
    onCursorMoveRef,
  } = args;

  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const hoverState = { active: false, clientX: 0, clientY: 0 };
  let isPointerInteracting = false;
  let cursorRefreshTimer: number | null = null;

  function clearCursorRefreshTimer() {
    if (cursorRefreshTimer === null) return;
    window.clearTimeout(cursorRefreshTimer);
    cursorRefreshTimer = null;
  }

  function updateCursorTooltip() {
    if (!hoverState.active) return;
    if (isPointerInteracting || keysHeldRef.current.size > 0) return;

    const targets: THREE.Object3D[] = [];
    if (
      modeRef.current === "terrain" &&
      showTerrainRef.current &&
      terrainGroupRef.current
    ) {
      targets.push(terrainGroupRef.current);
    }
    if (modeRef.current === "voxel" && voxelGroupRef.current) {
      targets.push(voxelGroupRef.current);
    }
    if (targets.length === 0) {
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

    const intersections = raycaster.intersectObjects(targets, true);
    if (intersections.length === 0) {
      onCursorMoveRef.current(null);
      return;
    }

    const point = intersections[0].point;
    onCursorMoveRef.current([
      Math.round(point.x),
      Math.round(-point.y),
      Math.round(point.z),
    ]);
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
    hoverState.active = true;
    hoverState.clientX = e.clientX;
    hoverState.clientY = e.clientY;
    if (isPointerInteracting || keysHeldRef.current.size > 0) return;
    updateCursorTooltip();
  }

  function onPointerDown() {
    isPointerInteracting = true;
    clearCursorRefreshTimer();
    onCursorMoveRef.current(null);
  }

  function onPointerUp() {
    isPointerInteracting = false;
    scheduleCursorTooltipRefresh();
  }

  function onPointerCancel() {
    isPointerInteracting = false;
    clearCursorRefreshTimer();
    onCursorMoveRef.current(null);
  }

  function onPointerLeave() {
    hoverState.active = false;
    isPointerInteracting = false;
    clearCursorRefreshTimer();
    onCursorMoveRef.current(null);
  }

  return {
    clearCursorRefreshTimer,
    scheduleCursorTooltipRefresh,
    updateCursorTooltip,
    onPointerMove,
    onPointerDown,
    onPointerUp,
    onPointerCancel,
    onPointerLeave,
  };
}
