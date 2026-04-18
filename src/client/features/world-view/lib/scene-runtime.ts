import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import type { MapDebugSettings } from "../../../lib/world-view-debug.js";
import type { PlayerData } from "../hooks/usePlayers.js";
import type { useWorldData } from "../hooks/useWorldData.js";
import {
  focusCameraOnWorldPosition,
  updateKeyboardCameraMotion,
} from "./camera.js";
import { createCursorInteractionHandlers } from "./cursor.js";
import {
  DAYLIGHT_FILL_POSITION,
  DAYLIGHT_MAIN_SUN_POSITION,
} from "./daylight.js";
import type { WorkerOut } from "./types.js";
import { shouldRenderTerrainForMode } from "./utils.js";

const MIN_CAMERA_DISTANCE = 1;
const ACTIVE_LOD_POLL_INTERVAL_MS = 125;
const IDLE_LOD_POLL_INTERVAL_MS = 1000;
const IDLE_ENTER_DELAY_MS = 500;

export function initializeSceneRuntime(args: {
  container: HTMLDivElement;
  sceneRef: {
    current: {
      renderer: THREE.WebGLRenderer;
      scene: THREE.Scene;
      camera: THREE.PerspectiveCamera;
      controls: OrbitControls;
      animFrameId: number;
    } | null;
  };
  labelRendererRef: { current: CSS2DRenderer | null };
  workerRef: { current: Worker | null };
  initializedRef: { current: boolean };
  terrainGroupRef: { current: THREE.Group | null };
  voxelGroupRef: { current: THREE.Group | null };
  markerGroupRef: { current: THREE.Group | null };
  spawnGroupRef: { current: THREE.Group | null };
  chunkBorderGroupRef: { current: THREE.Group | null };
  debugLabelGroupRef: { current: THREE.Group | null };
  biomeLabelGroupRef: { current: THREE.Group | null };
  modeRef: { current: "terrain" | "voxel" };
  showTerrainRef: { current: boolean };
  showVoxelTerrainRef: { current: boolean };
  showBiomeLabelsRef: { current: boolean };
  debugEnabledRef: { current: boolean };
  debugSettingsRef: { current: MapDebugSettings };
  keysHeldRef: { current: Set<string> };
  terrainLoadGenerationRef: { current: number };
  worldDataRef: {
    current: ReturnType<typeof useWorldData>;
  };
  onCursorMoveRef: { current: (pos: [number, number, number] | null) => void };
  onPlayerClickRef: { current: (player: PlayerData) => void };
  terrainVisibilityDirtyRef: { current: boolean };
  debugLabelsDirtyRef: { current: boolean };
  biomeLabelsDirtyRef: { current: boolean };
  updateMarkerScales: (
    camera: THREE.PerspectiveCamera,
    controls: OrbitControls,
  ) => void;
  handleWorkerMessage: (data: WorkerOut) => void;
  buildQueuedTerrainMeshes: () => boolean;
  buildQueuedVoxelMeshes: (
    renderer: THREE.WebGLRenderer,
    preUploadTarget: THREE.WebGLRenderTarget,
    preUploadScene: THREE.Scene,
    preUploadCamera: THREE.Camera,
  ) => boolean;
  checkAndUpdateLOD: (
    camera: THREE.PerspectiveCamera,
    controls: OrbitControls,
  ) => void;
  updateTerrainVisibility: (target: THREE.Vector3, camDist: number) => void;
  refreshDebugLabels: () => void;
  clearDebugLabels: () => void;
  refreshBiomeLabels: (
    target: THREE.Vector3,
    camDist: number,
  ) => Promise<void> | void;
  publishChunkStats: (fpsValue: number) => void;
  publishLoadingBreakdown: () => void;
  hasPendingSceneWork: () => boolean;
  clearTerrainTiles: () => void;
  clearVoxelTiles: () => void;
  clearBiomeLabels: () => void;
  terrainMaterial: THREE.Material;
  voxelMaterial: THREE.Material;
}): () => void {
  const {
    container,
    sceneRef,
    labelRendererRef,
    workerRef,
    initializedRef,
    terrainGroupRef,
    voxelGroupRef,
    markerGroupRef,
    spawnGroupRef,
    chunkBorderGroupRef,
    debugLabelGroupRef,
    biomeLabelGroupRef,
    modeRef,
    showTerrainRef,
    showVoxelTerrainRef,
    showBiomeLabelsRef,
    debugEnabledRef,
    debugSettingsRef,
    keysHeldRef,
    terrainLoadGenerationRef,
    worldDataRef,
    onCursorMoveRef,
    onPlayerClickRef,
    terrainVisibilityDirtyRef,
    debugLabelsDirtyRef,
    biomeLabelsDirtyRef,
    updateMarkerScales,
    handleWorkerMessage,
    buildQueuedTerrainMeshes,
    buildQueuedVoxelMeshes,
    checkAndUpdateLOD,
    updateTerrainVisibility,
    refreshDebugLabels,
    clearDebugLabels,
    refreshBiomeLabels,
    publishChunkStats,
    publishLoadingBreakdown,
    hasPendingSceneWork,
    clearTerrainTiles,
    clearVoxelTiles,
    clearBiomeLabels,
    terrainMaterial,
    voxelMaterial,
  } = args;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);

  const camera = new THREE.PerspectiveCamera(
    60,
    container.clientWidth / container.clientHeight,
    1,
    50000,
  );
  camera.up.set(0, 0, 1);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.domElement.style.touchAction = "none";
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.minDistance = MIN_CAMERA_DISTANCE;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.maxDistance = 15_000;
  controls.screenSpacePanning = false;
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.PAN,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.ROTATE,
  };
  controls.touches = {
    ONE: THREE.TOUCH.PAN,
    TWO: THREE.TOUCH.DOLLY_ROTATE,
  };

  // Keep the darker backdrop, but light the world itself like midday.
  // Favor a stronger sun over flat ambient fill so terrain and voxels keep readable shading.
  scene.add(new THREE.AmbientLight(0x43485a, 0.7));
  const skyLight = new THREE.HemisphereLight(0xd7e7ff, 0x66704f, 0.55);
  skyLight.position.set(0, 0, 1);
  scene.add(skyLight);
  const directionalLight = new THREE.DirectionalLight(0xffffff, 1.75);
  directionalLight.position.set(
    DAYLIGHT_MAIN_SUN_POSITION.x,
    DAYLIGHT_MAIN_SUN_POSITION.y,
    DAYLIGHT_MAIN_SUN_POSITION.z,
  );
  scene.add(directionalLight);
  const fillLight = new THREE.DirectionalLight(0xbec8d8, 0.18);
  fillLight.position.set(
    DAYLIGHT_FILL_POSITION.x,
    DAYLIGHT_FILL_POSITION.y,
    DAYLIGHT_FILL_POSITION.z,
  );
  scene.add(fillLight);

  const terrainGroup = new THREE.Group();
  const voxelGroup = new THREE.Group();
  const markerGroup = new THREE.Group();
  const spawnGroup = new THREE.Group();
  const chunkBorderGroup = new THREE.Group();
  scene.add(
    terrainGroup,
    voxelGroup,
    markerGroup,
    spawnGroup,
    chunkBorderGroup,
  );
  terrainGroupRef.current = terrainGroup;
  voxelGroupRef.current = voxelGroup;
  markerGroupRef.current = markerGroup;
  spawnGroupRef.current = spawnGroup;
  chunkBorderGroupRef.current = chunkBorderGroup;

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(container.clientWidth, container.clientHeight);
  labelRenderer.domElement.style.position = "absolute";
  labelRenderer.domElement.style.top = "0";
  labelRenderer.domElement.style.left = "0";
  labelRenderer.domElement.style.pointerEvents = "none";
  container.appendChild(labelRenderer.domElement);
  labelRendererRef.current = labelRenderer;

  const debugLabelGroup = new THREE.Group();
  const biomeLabelGroup = new THREE.Group();
  scene.add(debugLabelGroup);
  scene.add(biomeLabelGroup);
  debugLabelGroupRef.current = debugLabelGroup;
  biomeLabelGroupRef.current = biomeLabelGroup;

  const preUploadTarget = new THREE.WebGLRenderTarget(1, 1);
  const preUploadScene = new THREE.Scene();
  const preUploadCamera = new THREE.PerspectiveCamera();

  const worker = new Worker(
    new URL("../workers/voxel-mesh.worker.ts", import.meta.url),
    { type: "module" },
  );
  workerRef.current = worker;
  worker.onmessage = (e: MessageEvent) => {
    handleWorkerMessage(e.data as WorkerOut);
  };

  worker.onerror = () => {};

  const cursorHandlers = createCursorInteractionHandlers({
    renderer,
    camera,
    modeRef,
    showTerrainRef,
    showVoxelTerrainRef,
    terrainGroupRef,
    voxelGroupRef,
    keysHeldRef,
    onCursorMoveRef,
  });

  function focusCameraOnSpawn() {
    const spawn = worldDataRef.current.worldData?.spawn;
    if (!spawn) return;
    focusCameraOnWorldPosition(camera, controls, spawn);
    terrainVisibilityDirtyRef.current = true;
    debugLabelsDirtyRef.current = true;
    biomeLabelsDirtyRef.current = true;
  }

  function handlePlayerMarkerClick(e: PointerEvent) {
    if (!markerGroupRef.current) return;

    const rect = renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const pointerNdc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointerNdc, camera);

    const intersections = raycaster.intersectObjects(
      markerGroupRef.current.children,
      true,
    );
    const hit = intersections.find(
      (entry) => entry.object.userData.playerMarker === true,
    );
    const player = hit?.object.userData.player as PlayerData | undefined;
    if (player) {
      onPlayerClickRef.current(player);
    }
  }

  let animFrameId = 0;
  let biomeRefreshCounter = 0;
  let fpsFrameCounter = 0;
  let fpsLastTs = performance.now();
  let fpsValue = 0;
  let nextFrameAt = performance.now();
  let nextLodPollAt = performance.now() + ACTIVE_LOD_POLL_INTERVAL_MS;
  let isPointerOverCanvas = false;
  let isPointerInteracting = false;
  let lastActiveAt = performance.now();
  let currentEffectiveCap = debugSettingsRef.current.frameRateCapFps;

  function markActive(at = performance.now()) {
    lastActiveAt = at;
  }

  function resetFrameDeadline(now: number, frameIntervalMs: number) {
    nextFrameAt = frameIntervalMs > 0 ? now + frameIntervalMs : now;
  }

  function scheduleNextLodPoll(now: number, isIdle: boolean) {
    nextLodPollAt =
      now + (isIdle ? IDLE_LOD_POLL_INTERVAL_MS : ACTIVE_LOD_POLL_INTERVAL_MS);
  }

  function runLodUpdate(now: number, isIdle: boolean) {
    checkAndUpdateLOD(camera, controls);
    scheduleNextLodPoll(now, isIdle);
  }

  function animate(now = performance.now()) {
    animFrameId = requestAnimationFrame(animate);
    if (sceneRef.current) {
      sceneRef.current.animFrameId = animFrameId;
    }

    const hasPendingWork = hasPendingSceneWork();
    const hasDirtySceneState =
      terrainVisibilityDirtyRef.current ||
      debugLabelsDirtyRef.current ||
      biomeLabelsDirtyRef.current;
    const idleEligible =
      !isPointerOverCanvas &&
      !isPointerInteracting &&
      keysHeldRef.current.size === 0 &&
      !hasPendingWork &&
      !hasDirtySceneState &&
      now - lastActiveAt >= IDLE_ENTER_DELAY_MS;

    const activeCap = debugSettingsRef.current.frameRateCapFps;
    const idleCap = debugSettingsRef.current.idleFrameRateCapFps;
    const effectiveCap = idleEligible
      ? activeCap <= 0
        ? idleCap
        : Math.min(activeCap, idleCap)
      : activeCap;

    if (effectiveCap !== currentEffectiveCap) {
      currentEffectiveCap = effectiveCap;
      resetFrameDeadline(now, effectiveCap > 0 ? 1000 / effectiveCap : 0);
      scheduleNextLodPoll(now, idleEligible);
    }

    const frameIntervalMs = effectiveCap <= 0 ? 0 : 1000 / effectiveCap;
    if (frameIntervalMs > 0) {
      if (now < nextFrameAt) {
        return;
      }

      const nextTarget = nextFrameAt + frameIntervalMs;
      nextFrameAt =
        now - nextTarget > frameIntervalMs ? now + frameIntervalMs : nextTarget;
    } else {
      nextFrameAt = now;
    }

    updateKeyboardCameraMotion(camera, controls, keysHeldRef.current);

    controls.update();
    updateMarkerScales(camera, controls);

    const builtTerrainTile = buildQueuedTerrainMeshes();
    const builtVoxelTile = buildQueuedVoxelMeshes(
      renderer,
      preUploadTarget,
      preUploadScene,
      preUploadCamera,
    );
    if (builtTerrainTile || builtVoxelTile) {
      markActive(now);
      runLodUpdate(now, idleEligible);
    }

    if (
      terrainVisibilityDirtyRef.current &&
      shouldRenderTerrainForMode(
        modeRef.current,
        showTerrainRef.current,
        showVoxelTerrainRef.current,
      )
    ) {
      const camDist = camera.position.distanceTo(controls.target);
      updateTerrainVisibility(controls.target, camDist);
      terrainVisibilityDirtyRef.current = false;
      markActive(now);
    }

    if (debugEnabledRef.current && debugLabelsDirtyRef.current) {
      debugLabelsDirtyRef.current = false;
      refreshDebugLabels();
      markActive(now);
    } else if (!debugEnabledRef.current && debugLabelsDirtyRef.current) {
      debugLabelsDirtyRef.current = false;
      clearDebugLabels();
      markActive(now);
    }

    if (showBiomeLabelsRef.current && biomeLabelsDirtyRef.current) {
      biomeRefreshCounter++;
      if (biomeRefreshCounter % 20 === 0) {
        biomeLabelsDirtyRef.current = false;
        const camDist = camera.position.distanceTo(controls.target);
        void refreshBiomeLabels(controls.target, camDist);
        markActive(now);
      }
    }

    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);

    publishLoadingBreakdown();

    if (debugEnabledRef.current) {
      fpsFrameCounter++;
      const fpsNow = performance.now();
      if (fpsNow - fpsLastTs >= 500) {
        fpsValue = Math.round((fpsFrameCounter * 1000) / (fpsNow - fpsLastTs));
        fpsFrameCounter = 0;
        fpsLastTs = fpsNow;
      }
      publishChunkStats(fpsValue);
    }

    if (now >= nextLodPollAt) {
      runLodUpdate(now, idleEligible);
    }
  }

  animate();

  function onResize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    labelRenderer.setSize(w, h);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement
    )
      return;
    if (e.code === "Space") {
      e.preventDefault();
      focusCameraOnSpawn();
      markActive();
      return;
    }
    const hadKeys = keysHeldRef.current.size > 0;
    keysHeldRef.current.add(e.code);
    markActive();
    if (!hadKeys) {
      cursorHandlers.clearCursorRefreshTimer();
      onCursorMoveRef.current(null);
    }
  }

  function onKeyUp(e: KeyboardEvent) {
    keysHeldRef.current.delete(e.code);
    markActive();
    if (keysHeldRef.current.size === 0) {
      cursorHandlers.scheduleCursorTooltipRefresh();
    }
  }

  function onControlsChange() {
    markActive();
    if (keysHeldRef.current.size > 0) return;
    cursorHandlers.scheduleCursorTooltipRefresh();
  }

  function resetTransientInputState() {
    keysHeldRef.current.clear();
    isPointerInteracting = false;
    cursorHandlers.resetCursorInteractionState();
  }

  function onPointerEnter() {
    isPointerOverCanvas = true;
    markActive();
    cursorHandlers.clearTouchLingerTimer();
    if (!isPointerInteracting && keysHeldRef.current.size === 0) {
      cursorHandlers.scheduleCursorTooltipRefresh();
    }
  }

  function onPointerDown(e: PointerEvent) {
    isPointerInteracting = true;
    markActive();
    cursorHandlers.onPointerDown(e);
  }

  function onPointerUp(e: PointerEvent) {
    isPointerInteracting = false;
    markActive();
    cursorHandlers.onPointerUp(e);
  }

  function onPointerCancel(e: PointerEvent) {
    isPointerInteracting = false;
    markActive();
    cursorHandlers.onPointerCancel(e);
  }

  function onPointerLeave(e: PointerEvent) {
    isPointerOverCanvas = false;
    isPointerInteracting = false;
    cursorHandlers.onPointerLeave(e);
  }

  function onWindowBlur() {
    markActive();
    resetTransientInputState();
  }

  function onVisibilityChange() {
    if (!document.hidden) {
      markActive();
      if (isPointerOverCanvas) {
        cursorHandlers.scheduleCursorTooltipRefresh();
      }
      return;
    }

    onWindowBlur();
  }

  window.addEventListener("resize", onResize);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onWindowBlur);
  document.addEventListener("visibilitychange", onVisibilityChange);
  controls.addEventListener("change", onControlsChange);
  renderer.domElement.addEventListener("pointerenter", onPointerEnter);
  renderer.domElement.addEventListener(
    "pointermove",
    cursorHandlers.onPointerMove,
  );
  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointerup", onPointerUp);
  renderer.domElement.addEventListener("click", handlePlayerMarkerClick);
  renderer.domElement.addEventListener("pointercancel", onPointerCancel);
  renderer.domElement.addEventListener("pointerleave", onPointerLeave);

  sceneRef.current = { renderer, scene, camera, controls, animFrameId };

  return () => {
    cancelAnimationFrame(animFrameId);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onWindowBlur);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    controls.removeEventListener("change", onControlsChange);
    renderer.domElement.removeEventListener("pointerenter", onPointerEnter);
    renderer.domElement.removeEventListener(
      "pointermove",
      cursorHandlers.onPointerMove,
    );
    renderer.domElement.removeEventListener("pointerdown", onPointerDown);
    renderer.domElement.removeEventListener("pointerup", onPointerUp);
    renderer.domElement.removeEventListener("click", handlePlayerMarkerClick);
    renderer.domElement.removeEventListener("pointercancel", onPointerCancel);
    renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
    cursorHandlers.resetCursorInteractionState();

    clearTerrainTiles();
    clearVoxelTiles();
    clearDebugLabels();
    clearBiomeLabels();

    controls.dispose();
    preUploadTarget.dispose();
    renderer.dispose();
    if (container.contains(renderer.domElement)) {
      container.removeChild(renderer.domElement);
    }
    if (container.contains(labelRenderer.domElement)) {
      container.removeChild(labelRenderer.domElement);
    }
    labelRendererRef.current = null;

    worker.terminate();
    workerRef.current = null;
    terrainMaterial.dispose();
    voxelMaterial.dispose();

    sceneRef.current = null;
    terrainGroupRef.current = null;
    voxelGroupRef.current = null;
    markerGroupRef.current = null;
    spawnGroupRef.current = null;
    chunkBorderGroupRef.current = null;
    debugLabelGroupRef.current = null;
    biomeLabelGroupRef.current = null;
    initializedRef.current = false;
    terrainLoadGenerationRef.current += 1;
    keysHeldRef.current.clear();
  };
}
