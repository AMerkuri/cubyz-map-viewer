import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
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
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
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
  let lodCheckCounter = 0;
  let biomeRefreshCounter = 0;
  let fpsFrameCounter = 0;
  let fpsLastTs = performance.now();
  let fpsValue = 0;
  const lodCheckInterval = 8;

  function animate() {
    animFrameId = requestAnimationFrame(animate);
    if (sceneRef.current) {
      sceneRef.current.animFrameId = animFrameId;
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
      checkAndUpdateLOD(camera, controls);
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
    }

    if (debugEnabledRef.current && debugLabelsDirtyRef.current) {
      debugLabelsDirtyRef.current = false;
      refreshDebugLabels();
    } else if (!debugEnabledRef.current && debugLabelsDirtyRef.current) {
      debugLabelsDirtyRef.current = false;
      clearDebugLabels();
    }

    if (showBiomeLabelsRef.current && biomeLabelsDirtyRef.current) {
      biomeRefreshCounter++;
      if (biomeRefreshCounter % 20 === 0) {
        biomeLabelsDirtyRef.current = false;
        const camDist = camera.position.distanceTo(controls.target);
        void refreshBiomeLabels(controls.target, camDist);
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

    lodCheckCounter++;
    if (lodCheckCounter >= lodCheckInterval) {
      lodCheckCounter = 0;
      checkAndUpdateLOD(camera, controls);
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
      return;
    }
    const hadKeys = keysHeldRef.current.size > 0;
    keysHeldRef.current.add(e.code);
    if (!hadKeys) {
      cursorHandlers.clearCursorRefreshTimer();
      onCursorMoveRef.current(null);
    }
  }

  function onKeyUp(e: KeyboardEvent) {
    keysHeldRef.current.delete(e.code);
    if (keysHeldRef.current.size === 0) {
      cursorHandlers.scheduleCursorTooltipRefresh();
    }
  }

  function onControlsChange() {
    if (keysHeldRef.current.size > 0) return;
    cursorHandlers.scheduleCursorTooltipRefresh();
  }

  window.addEventListener("resize", onResize);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  controls.addEventListener("change", onControlsChange);
  renderer.domElement.addEventListener(
    "pointermove",
    cursorHandlers.onPointerMove,
  );
  renderer.domElement.addEventListener(
    "pointerdown",
    cursorHandlers.onPointerDown,
  );
  renderer.domElement.addEventListener("pointerup", cursorHandlers.onPointerUp);
  renderer.domElement.addEventListener("click", handlePlayerMarkerClick);
  renderer.domElement.addEventListener(
    "pointercancel",
    cursorHandlers.onPointerCancel,
  );
  renderer.domElement.addEventListener(
    "pointerleave",
    cursorHandlers.onPointerLeave,
  );

  sceneRef.current = { renderer, scene, camera, controls, animFrameId };

  return () => {
    cancelAnimationFrame(animFrameId);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    controls.removeEventListener("change", onControlsChange);
    renderer.domElement.removeEventListener(
      "pointermove",
      cursorHandlers.onPointerMove,
    );
    renderer.domElement.removeEventListener(
      "pointerdown",
      cursorHandlers.onPointerDown,
    );
    renderer.domElement.removeEventListener(
      "pointerup",
      cursorHandlers.onPointerUp,
    );
    renderer.domElement.removeEventListener("click", handlePlayerMarkerClick);
    renderer.domElement.removeEventListener(
      "pointercancel",
      cursorHandlers.onPointerCancel,
    );
    renderer.domElement.removeEventListener(
      "pointerleave",
      cursorHandlers.onPointerLeave,
    );
    cursorHandlers.clearCursorRefreshTimer();

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
