import { useEffect, useEffectEvent } from "react";
import type * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { type ChunkStats, createEmptyChunkStats } from "../debug.js";
import type { PlayerData } from "../hooks/usePlayers.js";
import type { TerrainUpdatesBatchEvent } from "../hooks/useWebSocket.js";
import type {
  ChunkIndexEntry,
  SurfaceIndexEntry,
  useWorldData,
} from "../hooks/useWorldData.js";
import {
  applyInitialCameraState,
  focusCameraOnWorldPosition,
} from "./camera.js";
import { TERRAIN_UNDERLAY_OFFSET_Z } from "./constants.js";
import { initializeSceneRuntime } from "./scene-runtime.js";
import type { InitialCameraState, World3DViewProps } from "./types.js";
import { shouldRenderTerrainForMode } from "./utils.js";

interface SceneRuntimeState {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  animFrameId: number;
}

export function useWorld3DSceneRuntime(args: {
  containerRef: { current: HTMLDivElement | null };
  sceneRef: { current: SceneRuntimeState | null };
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
  handleWorkerMessage: (data: import("./types.js").WorkerOut) => void;
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
  clearVoxelTiles: (preserveWarmCache?: boolean) => void;
  clearBiomeLabels: () => void;
  terrainMaterial: THREE.Material;
  voxelMaterial: THREE.Material;
}): void {
  const {
    containerRef,
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

  const onUpdateMarkerScales = useEffectEvent(updateMarkerScales);
  const onHandleWorkerMessage = useEffectEvent(handleWorkerMessage);
  const onBuildQueuedTerrainMeshes = useEffectEvent(buildQueuedTerrainMeshes);
  const onBuildQueuedVoxelMeshes = useEffectEvent(buildQueuedVoxelMeshes);
  const onCheckAndUpdateLOD = useEffectEvent(checkAndUpdateLOD);
  const onUpdateTerrainVisibility = useEffectEvent(updateTerrainVisibility);
  const onRefreshDebugLabels = useEffectEvent(refreshDebugLabels);
  const onClearDebugLabels = useEffectEvent(clearDebugLabels);
  const onRefreshBiomeLabels = useEffectEvent(refreshBiomeLabels);
  const onPublishChunkStats = useEffectEvent(publishChunkStats);
  const onPublishLoadingBreakdown = useEffectEvent(publishLoadingBreakdown);
  const onClearTerrainTiles = useEffectEvent(clearTerrainTiles);
  const onClearVoxelTiles = useEffectEvent(clearVoxelTiles);
  const onClearBiomeLabels = useEffectEvent(clearBiomeLabels);

  useEffect(() => {
    if (!containerRef.current || sceneRef.current) return;

    return initializeSceneRuntime({
      container: containerRef.current,
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
      updateMarkerScales: onUpdateMarkerScales,
      handleWorkerMessage: onHandleWorkerMessage,
      buildQueuedTerrainMeshes: onBuildQueuedTerrainMeshes,
      buildQueuedVoxelMeshes: onBuildQueuedVoxelMeshes,
      checkAndUpdateLOD: onCheckAndUpdateLOD,
      updateTerrainVisibility: onUpdateTerrainVisibility,
      refreshDebugLabels: onRefreshDebugLabels,
      clearDebugLabels: onClearDebugLabels,
      refreshBiomeLabels: onRefreshBiomeLabels,
      publishChunkStats: onPublishChunkStats,
      publishLoadingBreakdown: onPublishLoadingBreakdown,
      clearTerrainTiles: onClearTerrainTiles,
      clearVoxelTiles: onClearVoxelTiles,
      clearBiomeLabels: onClearBiomeLabels,
      terrainMaterial,
      voxelMaterial,
    });
  }, [
    containerRef,
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
    terrainMaterial,
    voxelMaterial,
  ]);
}

export function useWorld3DInitialization(args: {
  initializedRef: { current: boolean };
  sceneRef: { current: SceneRuntimeState | null };
  worldDataLoading: boolean;
  surfaceIndex: SurfaceIndexEntry[];
  chunkIndex: ChunkIndexEntry[];
  spawn: [number, number, number] | null | undefined;
  surfaceIndexRef: { current: SurfaceIndexEntry[] };
  chunkIndexRef: { current: ChunkIndexEntry[] };
  rebuildVoxelIndexState: (entries: ChunkIndexEntry[]) => void;
  initialCameraState: InitialCameraState | null;
  addSpawnMarker: () => void;
  updatePlayerMarkers: () => void;
  checkAndUpdateLOD: (
    camera: THREE.PerspectiveCamera,
    controls: OrbitControls,
  ) => void;
}): void {
  const {
    initializedRef,
    sceneRef,
    worldDataLoading,
    surfaceIndex,
    chunkIndex,
    spawn,
    surfaceIndexRef,
    chunkIndexRef,
    rebuildVoxelIndexState,
    initialCameraState,
    addSpawnMarker,
    updatePlayerMarkers,
    checkAndUpdateLOD,
  } = args;

  const onRebuildVoxelIndexState = useEffectEvent(rebuildVoxelIndexState);
  const onAddSpawnMarker = useEffectEvent(addSpawnMarker);
  const onUpdatePlayerMarkers = useEffectEvent(updatePlayerMarkers);
  const onCheckAndUpdateLOD = useEffectEvent(checkAndUpdateLOD);

  useEffect(() => {
    if (initializedRef.current) return;
    if (!sceneRef.current) return;
    if (worldDataLoading) return;

    initializedRef.current = true;
    surfaceIndexRef.current = surfaceIndex;
    chunkIndexRef.current = chunkIndex;
    onRebuildVoxelIndexState(chunkIndex);

    const { camera, controls } = sceneRef.current;
    applyInitialCameraState({
      camera,
      controls,
      initialCameraState,
      spawn,
    });

    onAddSpawnMarker();
    onUpdatePlayerMarkers();
    onCheckAndUpdateLOD(camera, controls);
  }, [
    worldDataLoading,
    surfaceIndex,
    chunkIndex,
    spawn,
    initialCameraState,
    initializedRef,
    sceneRef,
    surfaceIndexRef,
    chunkIndexRef,
  ]);
}

export function useWorld3DChunkStatsReset(args: {
  modeRef: { current: "terrain" | "voxel" };
  onChunkStatsChangeRef: { current: (stats: ChunkStats) => void };
}): void {
  const { modeRef, onChunkStatsChangeRef } = args;

  const onResetChunkStats = useEffectEvent(() => {
    onChunkStatsChangeRef.current(createEmptyChunkStats(modeRef.current));
  });

  useEffect(() => {
    return () => {
      onResetChunkStats();
    };
  }, []);
}

export function useWorld3DSceneSyncEffects(args: {
  surfaceIndex: SurfaceIndexEntry[];
  chunkIndex: ChunkIndexEntry[];
  mode: "terrain" | "voxel";
  showTerrain: boolean;
  showVoxelTerrain: boolean;
  sceneRef: { current: SceneRuntimeState | null };
  surfaceIndexRef: { current: SurfaceIndexEntry[] };
  chunkIndexRef: { current: ChunkIndexEntry[] };
  rebuildVoxelIndexState: (entries: ChunkIndexEntry[]) => void;
  missingVoxelsRef: { current: Set<string> };
  failedVoxelsRef: { current: Map<string, number> };
  checkAndUpdateLOD: (
    camera: THREE.PerspectiveCamera,
    controls: OrbitControls,
  ) => void;
}): void {
  const {
    surfaceIndex,
    chunkIndex,
    mode,
    showTerrain,
    showVoxelTerrain,
    sceneRef,
    surfaceIndexRef,
    chunkIndexRef,
    rebuildVoxelIndexState,
    missingVoxelsRef,
    failedVoxelsRef,
    checkAndUpdateLOD,
  } = args;

  const onRebuildVoxelIndexState = useEffectEvent(rebuildVoxelIndexState);
  const onCheckAndUpdateLOD = useEffectEvent(checkAndUpdateLOD);

  useEffect(() => {
    surfaceIndexRef.current = surfaceIndex;
    if (
      shouldRenderTerrainForMode(mode, showTerrain, showVoxelTerrain) &&
      sceneRef.current
    ) {
      onCheckAndUpdateLOD(sceneRef.current.camera, sceneRef.current.controls);
    }
  }, [
    surfaceIndex,
    mode,
    showTerrain,
    showVoxelTerrain,
    sceneRef,
    surfaceIndexRef,
  ]);

  useEffect(() => {
    chunkIndexRef.current = chunkIndex;
    onRebuildVoxelIndexState(chunkIndex);
    if (mode === "voxel") {
      missingVoxelsRef.current.clear();
      failedVoxelsRef.current.clear();
      if (sceneRef.current) {
        onCheckAndUpdateLOD(sceneRef.current.camera, sceneRef.current.controls);
      }
    }
  }, [
    chunkIndex,
    mode,
    sceneRef,
    chunkIndexRef,
    missingVoxelsRef,
    failedVoxelsRef,
  ]);

  useEffect(() => {
    if (mode !== "voxel" || !sceneRef.current) return;
    onCheckAndUpdateLOD(sceneRef.current.camera, sceneRef.current.controls);
  }, [mode, sceneRef]);
}

export function useWorld3DDisplayEffects(args: {
  mode: "terrain" | "voxel";
  players: PlayerData[];
  showPlayers: boolean;
  showSpawn: boolean;
  showChunkBorders: boolean;
  showTerrain: boolean;
  showVoxelTerrain: boolean;
  showBiomeLabels: boolean;
  showVoxelHeightLabels: boolean;
  debugEnabled: boolean;
  sceneRef: { current: SceneRuntimeState | null };
  markerGroupRef: { current: THREE.Group | null };
  spawnGroupRef: { current: THREE.Group | null };
  chunkBorderGroupRef: { current: THREE.Group | null };
  terrainGroupRef: { current: THREE.Group | null };
  voxelGroupRef: { current: THREE.Group | null };
  debugLabelGroupRef: { current: THREE.Group | null };
  biomeLabelGroupRef: { current: THREE.Group | null };
  terrainVisibilityDirtyRef: { current: boolean };
  debugLabelsDirtyRef: { current: boolean };
  biomeLabelsDirtyRef: { current: boolean };
  updatePlayerMarkers: () => void;
  refreshDebugLabels: () => void;
  clearBiomeLabels: () => void;
  refreshBiomeLabels: (
    target: THREE.Vector3,
    camDist: number,
  ) => Promise<void> | void;
  clearVoxelTiles: (preserveWarmCache?: boolean) => void;
  clearTerrainTiles: () => void;
  checkAndUpdateLOD: (
    camera: THREE.PerspectiveCamera,
    controls: OrbitControls,
  ) => void;
}): void {
  const {
    mode,
    players,
    showPlayers,
    showSpawn,
    showChunkBorders,
    showTerrain,
    showVoxelTerrain,
    showBiomeLabels,
    showVoxelHeightLabels,
    debugEnabled,
    sceneRef,
    markerGroupRef,
    spawnGroupRef,
    chunkBorderGroupRef,
    terrainGroupRef,
    voxelGroupRef,
    debugLabelGroupRef,
    biomeLabelGroupRef,
    terrainVisibilityDirtyRef,
    debugLabelsDirtyRef,
    biomeLabelsDirtyRef,
    updatePlayerMarkers,
    refreshDebugLabels,
    clearBiomeLabels,
    refreshBiomeLabels,
    clearVoxelTiles,
    clearTerrainTiles,
    checkAndUpdateLOD,
  } = args;

  const onUpdatePlayerMarkers = useEffectEvent(updatePlayerMarkers);
  const onRefreshDebugLabels = useEffectEvent(refreshDebugLabels);
  const onClearBiomeLabels = useEffectEvent(clearBiomeLabels);
  const onRefreshBiomeLabels = useEffectEvent(refreshBiomeLabels);
  const onClearVoxelTiles = useEffectEvent(clearVoxelTiles);
  const onClearTerrainTiles = useEffectEvent(clearTerrainTiles);
  const onCheckAndUpdateLOD = useEffectEvent(checkAndUpdateLOD);

  useEffect(() => {
    void players;
    onUpdatePlayerMarkers();
  }, [players]);

  useEffect(() => {
    if (markerGroupRef.current) markerGroupRef.current.visible = showPlayers;
  }, [showPlayers, markerGroupRef]);

  useEffect(() => {
    if (spawnGroupRef.current) spawnGroupRef.current.visible = showSpawn;
  }, [showSpawn, spawnGroupRef]);

  useEffect(() => {
    if (chunkBorderGroupRef.current)
      chunkBorderGroupRef.current.visible = showChunkBorders;
  }, [showChunkBorders, chunkBorderGroupRef]);

  useEffect(() => {
    const renderTerrain = shouldRenderTerrainForMode(
      mode,
      showTerrain,
      showVoxelTerrain,
    );
    if (terrainGroupRef.current) {
      terrainGroupRef.current.visible = renderTerrain;
      terrainGroupRef.current.position.z =
        mode === "voxel" ? TERRAIN_UNDERLAY_OFFSET_Z : 0;
    }
    if (voxelGroupRef.current) {
      voxelGroupRef.current.visible = mode === "voxel";
    }
    terrainVisibilityDirtyRef.current = true;
    debugLabelsDirtyRef.current = true;
    biomeLabelsDirtyRef.current = true;
  }, [
    mode,
    showTerrain,
    showVoxelTerrain,
    terrainGroupRef,
    voxelGroupRef,
    terrainVisibilityDirtyRef,
    debugLabelsDirtyRef,
    biomeLabelsDirtyRef,
  ]);

  useEffect(() => {
    const group = debugLabelGroupRef.current;
    if (group) {
      group.visible =
        debugEnabled &&
        (showChunkBorders || (showVoxelHeightLabels && mode === "voxel"));
    }
    debugLabelsDirtyRef.current = true;
    if (sceneRef.current) {
      onRefreshDebugLabels();
    }
  }, [
    debugEnabled,
    showChunkBorders,
    showVoxelHeightLabels,
    mode,
    debugLabelGroupRef,
    debugLabelsDirtyRef,
    sceneRef,
  ]);

  useEffect(() => {
    const group = biomeLabelGroupRef.current;
    if (group) group.visible = showBiomeLabels;
    biomeLabelsDirtyRef.current = true;
    if (!showBiomeLabels && sceneRef.current) {
      onClearBiomeLabels();
    }
    if (showBiomeLabels && sceneRef.current) {
      const camDist = sceneRef.current.camera.position.distanceTo(
        sceneRef.current.controls.target,
      );
      void onRefreshBiomeLabels(sceneRef.current.controls.target, camDist);
    }
  }, [showBiomeLabels, biomeLabelGroupRef, biomeLabelsDirtyRef, sceneRef]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (mode === "terrain") {
      onClearVoxelTiles(true);
      debugLabelsDirtyRef.current = true;
      biomeLabelsDirtyRef.current = true;
    } else if (!showVoxelTerrain) {
      onClearTerrainTiles();
      debugLabelsDirtyRef.current = true;
      biomeLabelsDirtyRef.current = true;
    }

    onCheckAndUpdateLOD(scene.camera, scene.controls);
  }, [
    mode,
    showVoxelTerrain,
    sceneRef,
    debugLabelsDirtyRef,
    biomeLabelsDirtyRef,
  ]);
}

export function useWorld3DUpdateSubscription(args: {
  subscribe: World3DViewProps["subscribe"];
  handleTileUpdate: (lod: number, tileX: number, tileY: number) => void;
  handleRegionUpdate: (lod: number, regionX: number, regionY: number) => void;
}): void {
  const { subscribe, handleTileUpdate, handleRegionUpdate } = args;

  const onHandleTileUpdate = useEffectEvent(handleTileUpdate);
  const onHandleRegionUpdate = useEffectEvent(handleRegionUpdate);

  useEffect(() => {
    const unsubBatch = subscribe("terrain-updates-batch", (event) => {
      if (event.type !== "terrain-updates-batch") return;
      const batch = event as TerrainUpdatesBatchEvent;
      for (const tile of batch.data.tiles) {
        onHandleTileUpdate(tile.lod, tile.tileX, tile.tileY);
      }
      for (const region of batch.data.regions) {
        onHandleRegionUpdate(
          (region as { lod?: number }).lod ?? 1,
          region.regionX,
          region.regionY,
        );
      }
    });

    return () => {
      unsubBatch();
    };
  }, [subscribe]);
}

export function useWorld3DFlyToEffect(args: {
  flyToRequest: World3DViewProps["flyToRequest"];
  sceneRef: { current: SceneRuntimeState | null };
}): void {
  const { flyToRequest, sceneRef } = args;

  useEffect(() => {
    if (!flyToRequest || !sceneRef.current) return;
    focusCameraOnWorldPosition(
      sceneRef.current.camera,
      sceneRef.current.controls,
      flyToRequest.pos,
    );
  }, [flyToRequest, sceneRef]);
}
