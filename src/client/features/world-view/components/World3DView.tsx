import type { QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useMemo, useRef } from "react";
import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type {
  CSS2DObject,
  CSS2DRenderer,
} from "three/addons/renderers/CSS2DRenderer.js";
import {
  createEmptyLoadingBreakdown,
  type LoadingBreakdown,
} from "../../../lib/world-view-debug.js";
import type { PlayerData } from "../hooks/usePlayers.js";
import type {
  ChunkIndexEntry,
  SurfaceIndexEntry,
} from "../hooks/useWorldData.js";
import {
  type AvatarAssetCache,
  DEFAULT_AVATAR_MODEL_ID,
  disposeAvatarAssetCache,
  ensureAvatarAssets,
} from "../lib/avatar-assets.js";
import { refreshBiomeLabels as refreshBiomeLabelsManaged } from "../lib/biome-labels.js";
import { patchVoxelMaterialWithBlockLight } from "../lib/block-light-mesh.js";
import type { BlockLightRuntimeStats } from "../lib/block-light-runtime.js";
import { retargetCameraStateToVisibleSurface } from "../lib/camera.js";
import { MAX_VOXEL_RETRIES, VOXEL_CHUNK_CELLS } from "../lib/constants.js";
import {
  clearCssLabelMap,
  refreshDebugLabels as refreshDebugLabelsManaged,
} from "../lib/debug-overlays.js";
import {
  handleTerrainTileUpdate,
  handleVoxelRegionUpdate,
} from "../lib/live-updates.js";
import { checkAndUpdateLod as checkAndUpdateLodManaged } from "../lib/lod-controller.js";
import {
  computeScreenSpaceDistanceScale,
  createVoxelLodDistanceThresholds,
} from "../lib/lod-utils.js";
import {
  rebuildSpawnMarker,
  syncPlayerMarkers,
  updatePlayerMarkerScale,
} from "../lib/markers.js";
import {
  createFormattedPlayerLabel,
  createMarkerDot,
  createMarkerLabel,
  createPlayerMarkerModel,
  disposePlayerMarkerModel,
  disposeTextSprite,
} from "../lib/primitives.js";
import { SignLayerManager } from "../lib/sign-layer.js";
import type { RollingVoxelBenchmarkStats } from "../lib/stats.js";
import {
  createEmptyVoxelBenchmarkStats,
  publishChunkStats,
} from "../lib/stats.js";
import {
  disposeTerrainTileResources as disposeTerrainTileResourcesManaged,
  ensureTerrainBorderAssets as ensureTerrainBorderAssetsManaged,
  evictWarmCachedTerrainTile as evictWarmCachedTerrainTileManaged,
  moveTerrainTileToWarmCache as moveTerrainTileToWarmCacheManaged,
  restoreTerrainTileFromWarmCache as restoreTerrainTileFromWarmCacheManaged,
} from "../lib/terrain-cache.js";
import {
  buildQueuedTerrainMeshes as buildQueuedTerrainMeshesManaged,
  clearTerrainTiles as clearTerrainTilesManaged,
  drainTerrainFetchQueue as drainTerrainFetchQueueManaged,
  fetchTerrainTile as fetchTerrainTileManaged,
  finishTerrainFetch as finishTerrainFetchManaged,
  queueTerrainFetchRequest as queueTerrainFetchRequestManaged,
  syncTerrainLod as syncTerrainLodManaged,
  syncTerrainRequests as syncTerrainRequestsManaged,
  terrainTileKey,
  updateTerrainVisibility as updateTerrainVisibilityManaged,
} from "../lib/terrain-manager.js";
import type {
  InitialCameraState,
  LoadedTerrainTile,
  LoadedVoxelTile,
  PendingTerrainFetchRequest,
  PendingTerrainMeshItem,
  PendingVoxelFetchRequest,
  PendingVoxelMeshItem,
  VoxelFocusState,
  VoxelRefreshState,
  WarmCachedTerrainTile,
  WarmCachedVoxelTile,
  WorkerOut,
  World3DViewProps,
} from "../lib/types.js";
import { regionWorldSize } from "../lib/utils.js";
import {
  useWorld3DChunkStatsReset,
  useWorld3DDisplayEffects,
  useWorld3DFlyToEffect,
  useWorld3DInitialization,
  useWorld3DSceneRuntime,
  useWorld3DSceneSyncEffects,
  useWorld3DUpdateSubscription,
} from "../lib/view-hooks.js";
import {
  disposeVoxelTileResources as disposeVoxelTileResourcesManaged,
  evictWarmCachedVoxelTile as evictWarmCachedVoxelTileManaged,
  moveVoxelTileToWarmCache as moveVoxelTileToWarmCacheManaged,
  restoreVoxelTileFromWarmCache as restoreVoxelTileFromWarmCacheManaged,
} from "../lib/voxel-cache.js";
import { resolveVoxelLodFocus } from "../lib/voxel-focus.js";
import { rebuildVoxelIndex } from "../lib/voxel-index.js";
import {
  fetchVoxelRegion as fetchVoxelRegionManaged,
  finishVoxelFetch as finishVoxelFetchManaged,
  getVoxelRefreshVersion as getVoxelRefreshVersionManaged,
  isVoxelTileStale as isVoxelTileStaleManaged,
  markVoxelTileFresh as markVoxelTileFreshManaged,
  markVoxelTileStale as markVoxelTileStaleManaged,
  queueVoxelFetchRequest as queueVoxelFetchRequestManaged,
  syncVoxelRequests as syncVoxelRequestsManaged,
} from "../lib/voxel-requests.js";
import {
  buildQueuedVoxelMeshes,
  clearVoxelTiles as clearVoxelTilesManaged,
  drainVoxelFetchQueue as drainVoxelFetchQueueManaged,
  handleVoxelWorkerMessage,
  requestDirectVoxelRefresh as requestDirectVoxelRefreshManaged,
  requestVoxelRegion as requestVoxelRegionManaged,
  updateVoxelLod as updateVoxelLodManaged,
} from "../lib/voxel-runtime.js";

const PLAYER_MARKER_BASE_SCALE = 4;
const PLAYER_MARKER_SCALE_REFERENCE_DISTANCE = 200;
const PLAYER_MARKER_MIN_SCALE = 1;
const PLAYER_MARKER_MAX_SCALE = 100;
const TEMP_TO_MARKER = new THREE.Vector3();

export function World3DView({
  worldData,
  players,
  subscribe,
  showPlayers,
  showSpawn,
  showChunkBorders,
  showTerrainUnderlay,
  showBiomeLabels,
  showVoxelHeightLabels,
  renderDistance,
  voxelLod1MaxDist,
  minRenderedVoxelLod,
  debugEnabled,
  debugSettings,
  onCursorMove,
  onPlayerClick,
  onChunkStatsChange,
  onLoadingBreakdownChange,
  initialCameraState,
  onShareStateChange,
  flyToRequest,
}: World3DViewProps) {
  const terrainMaterialRef = useRef<THREE.MeshLambertMaterial | null>(null);
  if (!terrainMaterialRef.current) {
    terrainMaterialRef.current = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
  }

  // FOR DEBUGGING
  // const voxelMaterialRef = useRef<THREE.MeshBasicMaterial | null>(null);
  // if (!voxelMaterialRef.current) {
  //   voxelMaterialRef.current = new THREE.MeshBasicMaterial({
  //     vertexColors: true,
  //     side: THREE.FrontSide,
  //   });
  // }
  const voxelMaterialRef = useRef<THREE.MeshLambertMaterial | null>(null);
  if (!voxelMaterialRef.current) {
    voxelMaterialRef.current = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.FrontSide,
    });
    patchVoxelMaterialWithBlockLight(voxelMaterialRef.current);
  }
  const transparentVoxelMaterialRef = useRef<THREE.MeshLambertMaterial | null>(
    null,
  );
  if (!transparentVoxelMaterialRef.current) {
    transparentVoxelMaterialRef.current = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
    });
  }

  const terrainMaterial = terrainMaterialRef.current;
  const voxelMaterial = voxelMaterialRef.current;
  const transparentVoxelMaterial = transparentVoxelMaterialRef.current;

  const queryClient = useQueryClient();
  const queryClientRef = useRef<QueryClient>(queryClient);
  queryClientRef.current = queryClient;

  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    animFrameId: number;
  } | null>(null);

  const initializedRef = useRef(false);
  const terrainGroupRef = useRef<THREE.Group | null>(null);
  const voxelGroupRef = useRef<THREE.Group | null>(null);
  const markerGroupRef = useRef<THREE.Group | null>(null);
  const spawnGroupRef = useRef<THREE.Group | null>(null);
  const chunkBorderGroupRef = useRef<THREE.Group | null>(null);

  const labelRendererRef = useRef<CSS2DRenderer | null>(null);
  const debugLabelGroupRef = useRef<THREE.Group | null>(null);
  const biomeLabelGroupRef = useRef<THREE.Group | null>(null);
  const debugLabelMapRef = useRef<Map<string, CSS2DObject>>(new Map());
  const biomeLabelMapRef = useRef<Map<string, CSS2DObject>>(new Map());

  const loadedTerrainRef = useRef<Map<string, LoadedTerrainTile>>(new Map());
  const warmCachedTerrainRef = useRef<Map<string, WarmCachedTerrainTile>>(
    new Map(),
  );
  const warmCachedTerrainBytesRef = useRef(0);
  const loadingTerrainRef = useRef<Set<string>>(new Set());
  const pendingTerrainFetchQueueRef = useRef<PendingTerrainFetchRequest[]>([]);
  const pendingTerrainMeshQueueRef = useRef<PendingTerrainMeshItem[]>([]);
  const activeTerrainFetchCountRef = useRef(0);
  const terrainFetchControllersRef = useRef<Map<string, AbortController>>(
    new Map(),
  );
  const activeTerrainRequestKeysRef = useRef<Set<string>>(new Set());

  const loadedVoxelsRef = useRef<Map<string, LoadedVoxelTile>>(new Map());
  const warmCachedVoxelsRef = useRef<Map<string, WarmCachedVoxelTile>>(
    new Map(),
  );
  const warmCachedVoxelBytesRef = useRef(0);
  const loadingVoxelsRef = useRef<Set<string>>(new Set());
  const missingVoxelsRef = useRef<Set<string>>(new Set());
  const failedVoxelsRef = useRef<Map<string, number>>(new Map());
  const pendingVoxelFetchQueueRef = useRef<PendingVoxelFetchRequest[]>([]);
  const activeVoxelFetchCountRef = useRef(0);
  const voxelFetchControllersRef = useRef<Map<string, AbortController>>(
    new Map(),
  );
  const voxelRefreshStatesRef = useRef<Map<string, VoxelRefreshState>>(
    new Map(),
  );
  const activeVoxelRequestKeysRef = useRef<Set<string>>(new Set());
  const activeVoxelRequestGenerationRef = useRef(0);
  const pendingVoxelDetailRequestsRef = useRef<
    Map<string, PendingVoxelFetchRequest>
  >(new Map());
  const committedVoxelDetailRequestsRef = useRef<
    Map<string, PendingVoxelFetchRequest>
  >(new Map());
  const voxelUnloadGraceUntilRef = useRef<Map<string, number>>(new Map());
  const voxelLastCameraSampleRef = useRef<{
    camera: THREE.Vector3;
    target: THREE.Vector3;
  } | null>(null);
  const voxelLastMotionAtRef = useRef(0);
  const pendingVoxelMeshQueueRef = useRef<PendingVoxelMeshItem[]>([]);
  const workerRef = useRef<Worker | null>(null);
  const pendingInitialSurfaceRetargetRef = useRef<InitialCameraState | null>(
    null,
  );

  const surfaceIndexRef = useRef<SurfaceIndexEntry[]>([]);
  const terrainIndexVersionRef = useRef(0);
  const chunkIndexRef = useRef(worldData.chunkIndex);
  const availableVoxelKeysRef = useRef<Set<string>>(new Set());
  const voxelRootEntriesRef = useRef<ChunkIndexEntry[]>([]);

  const playersRef = useRef(players);
  playersRef.current = players;
  const worldDataRef = useRef(worldData);
  worldDataRef.current = worldData;

  const onCursorMoveRef = useRef(onCursorMove);
  onCursorMoveRef.current = onCursorMove;
  const onPlayerClickRef = useRef(onPlayerClick);
  onPlayerClickRef.current = onPlayerClick;
  const onChunkStatsChangeRef = useRef(onChunkStatsChange);
  onChunkStatsChangeRef.current = onChunkStatsChange;
  const onLoadingBreakdownChangeRef = useRef(onLoadingBreakdownChange);
  onLoadingBreakdownChangeRef.current = onLoadingBreakdownChange;
  const lastPublishedLoadingBreakdownRef = useRef<LoadingBreakdown>(
    createEmptyLoadingBreakdown(),
  );
  const debugEnabledRef = useRef(debugEnabled);
  debugEnabledRef.current = debugEnabled;
  const debugSettingsRef = useRef(debugSettings);
  debugSettingsRef.current = debugSettings;
  const onShareStateChangeRef = useRef(onShareStateChange);
  onShareStateChangeRef.current = onShareStateChange;

  const showPlayersRef = useRef(showPlayers);
  showPlayersRef.current = showPlayers;
  const showSpawnRef = useRef(showSpawn);
  showSpawnRef.current = showSpawn;
  const showChunkBordersRef = useRef(showChunkBorders);
  showChunkBordersRef.current = showChunkBorders;
  const showTerrainUnderlayRef = useRef(showTerrainUnderlay);
  showTerrainUnderlayRef.current = showTerrainUnderlay;
  const showBiomeLabelsRef = useRef(showBiomeLabels);
  showBiomeLabelsRef.current = showBiomeLabels;
  const showVoxelHeightLabelsRef = useRef(showVoxelHeightLabels);
  showVoxelHeightLabelsRef.current = showVoxelHeightLabels;
  const voxelLodThresholdsRef = useRef(
    createVoxelLodDistanceThresholds(voxelLod1MaxDist),
  );
  voxelLodThresholdsRef.current =
    createVoxelLodDistanceThresholds(voxelLod1MaxDist);

  const keysHeldRef = useRef<Set<string>>(new Set());
  const terrainVisibilityDirtyRef = useRef(false);
  const debugLabelsDirtyRef = useRef(false);
  const biomeLabelsDirtyRef = useRef(false);
  const terrainLoadGenerationRef = useRef(0);
  const activeTerrainRequestGenerationRef = useRef(0);
  const biomeRefreshTokenRef = useRef(0);
  const lastChunkStatsRef = useRef("");
  const voxelBenchmarkRef = useRef<RollingVoxelBenchmarkStats>(
    createEmptyVoxelBenchmarkStats(
      debugSettings.voxelHaloEmittersEnabled > 0,
      debugSettings.voxelEmissiveAttributesEnabled > 0,
    ),
  );
  // Debug-only voxel-lighting diagnostics: reset benchmark averages whenever
  // the active diagnostic matrix state changes so samples from different
  // matrix cells are never averaged together.
  const diagnosticsMatrixKey = `${debugSettings.voxelHaloEmittersEnabled > 0 ? 1 : 0}:${debugSettings.voxelEmissiveAttributesEnabled > 0 ? 1 : 0}`;
  const lastDiagnosticsMatrixKeyRef = useRef(diagnosticsMatrixKey);
  if (lastDiagnosticsMatrixKeyRef.current !== diagnosticsMatrixKey) {
    lastDiagnosticsMatrixKeyRef.current = diagnosticsMatrixKey;
    voxelBenchmarkRef.current = createEmptyVoxelBenchmarkStats(
      debugSettings.voxelHaloEmittersEnabled > 0,
      debugSettings.voxelEmissiveAttributesEnabled > 0,
    );
  }
  const blockLightStatsRef = useRef<BlockLightRuntimeStats>({
    decodedEmitters: 0,
    activeEmitters: 0,
    budget: 0,
    glowBudget: 0,
    pointLightBudget: 0,
    degraded: false,
  });
  const avatarAssetCacheRef = useRef<AvatarAssetCache>(new Map());
  const avatarAssetsLoadGenerationRef = useRef(0);
  const activeFocusLodRef = useRef<number>(1);
  const signLayerRef = useRef<SignLayerManager | null>(null);
  if (!signLayerRef.current) {
    signLayerRef.current = new SignLayerManager({
      queryClient,
      getActiveLod: () => activeFocusLodRef.current,
      requestRender: () => {},
    });
  }
  const activeTerrainLodRef = useRef<number>(1);
  const voxelFocusStateRef = useRef<VoxelFocusState>({
    point: new THREE.Vector3(),
    zoomDist: 0,
    lastSampleAt: 0,
    initialized: false,
  });

  const requiredAvatarModelIds = useMemo(() => {
    const ids = new Set<string>();
    if (showPlayers || players.length > 0) {
      // The default avatar backs any player whose own model fails to load.
      ids.add(DEFAULT_AVATAR_MODEL_ID);
    }
    for (const player of players) {
      if (typeof player.entityModelId === "string" && player.entityModelId) {
        ids.add(player.entityModelId);
      }
    }
    return [...ids].sort();
  }, [players, showPlayers]);

  const requiredAvatarModelIdsKey = requiredAvatarModelIds.join("|");

  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed by requiredAvatarModelIdsKey to avoid array identity churn.
  useEffect(() => {
    if (requiredAvatarModelIds.length === 0) {
      return;
    }

    const generation = avatarAssetsLoadGenerationRef.current;
    ensureAvatarAssets({
      entityModelIds: requiredAvatarModelIds,
      cache: avatarAssetCacheRef.current,
      onChange: () => {
        onUpdatePlayerMarkers();
      },
      isCurrent: () => generation === avatarAssetsLoadGenerationRef.current,
    });
  }, [requiredAvatarModelIdsKey]);

  useEffect(() => {
    const cache = avatarAssetCacheRef.current;
    return () => {
      avatarAssetsLoadGenerationRef.current += 1;
      disposeAvatarAssetCache(cache);
    };
  }, []);

  useEffect(() => {
    const manager = signLayerRef.current;
    return () => {
      manager?.dispose(sceneRef.current?.scene ?? null);
    };
  }, []);

  function rebuildVoxelIndexCache(entries: ChunkIndexEntry[]) {
    const { availableKeys, roots } = rebuildVoxelIndex(entries);
    availableVoxelKeysRef.current = availableKeys;
    voxelRootEntriesRef.current = roots;
  }

  function clearDebugLabels() {
    clearCssLabelMap(debugLabelGroupRef.current, debugLabelMapRef.current);
  }

  function clearBiomeLabels() {
    clearCssLabelMap(biomeLabelGroupRef.current, biomeLabelMapRef.current);
  }

  function clearTerrainTiles() {
    for (const controller of terrainFetchControllersRef.current.values()) {
      controller.abort();
    }
    terrainFetchControllersRef.current.clear();
    pendingTerrainFetchQueueRef.current = [];
    pendingTerrainMeshQueueRef.current = [];
    activeTerrainFetchCountRef.current = 0;
    activeTerrainRequestKeysRef.current.clear();
    clearTerrainTilesManaged(
      loadedTerrainRef.current,
      terrainGroupRef.current,
      chunkBorderGroupRef.current,
      disposeTextSprite,
    );
    for (const key of [...warmCachedTerrainRef.current.keys()]) {
      evictWarmCachedTerrainTile(key);
    }
    loadingTerrainRef.current.clear();
  }

  function evictWarmCachedTerrainTile(key: string) {
    evictWarmCachedTerrainTileManaged(
      key,
      warmCachedTerrainRef.current,
      warmCachedTerrainBytesRef,
      terrainGroupRef.current,
      chunkBorderGroupRef.current,
      disposeTextSprite,
    );
  }

  function moveTerrainTileToWarmCache(tile: LoadedTerrainTile) {
    moveTerrainTileToWarmCacheManaged({
      tile,
      warmCachedTerrain: warmCachedTerrainRef.current,
      warmCachedTerrainBytesRef,
      warmTerrainCacheMaxBytes:
        debugSettingsRef.current.warmTerrainCacheMaxBytes,
      terrainGroup: terrainGroupRef.current,
      chunkBorderGroup: chunkBorderGroupRef.current,
      disposeTextSprite,
    });
  }

  function restoreTerrainTileFromWarmCache(
    key: string,
  ): LoadedTerrainTile | null {
    return restoreTerrainTileFromWarmCacheManaged({
      key,
      warmCachedTerrain: warmCachedTerrainRef.current,
      warmCachedTerrainBytesRef,
      terrainGroup: terrainGroupRef.current,
      chunkBorderGroup: chunkBorderGroupRef.current,
      showChunkBorders: showChunkBordersRef.current,
    });
  }

  function ensureTerrainBorderAssets(tile: LoadedTerrainTile) {
    ensureTerrainBorderAssetsManaged(
      tile,
      chunkBorderGroupRef.current,
      showChunkBordersRef.current,
    );
  }

  function disposeTerrainTile(
    tile: LoadedTerrainTile,
    preserveWarmCache = true,
  ) {
    if (preserveWarmCache) {
      moveTerrainTileToWarmCache(tile);
      return;
    }

    disposeTerrainTileResourcesManaged(
      tile,
      terrainGroupRef.current,
      chunkBorderGroupRef.current,
      disposeTextSprite,
    );
  }

  function queueTerrainTileLoad(
    lod: number,
    tileX: number,
    tileY: number,
    priority: number,
  ) {
    const key = terrainTileKey(lod, tileX, tileY);
    activeTerrainRequestKeysRef.current.add(key);
    if (
      loadedTerrainRef.current.has(key) ||
      loadingTerrainRef.current.has(key)
    ) {
      return;
    }

    loadingTerrainRef.current.add(key);
    queueTerrainFetchRequestManaged(pendingTerrainFetchQueueRef.current, {
      key,
      lod,
      tileX,
      tileY,
      priority,
      generation: terrainLoadGenerationRef.current,
    });
  }

  function syncTerrainRequests(
    requests: Map<string, PendingTerrainFetchRequest>,
  ) {
    syncTerrainRequestsManaged({
      requests,
      activeTerrainRequestKeysRef,
      pendingTerrainFetchQueueRef,
      pendingTerrainMeshQueueRef,
      loadedTerrainRef,
      loadingTerrainRef,
      terrainFetchControllersRef,
      restoreTerrainTileFromWarmCache,
      terrainVisibilityDirtyRef,
      debugLabelsDirtyRef,
      biomeLabelsDirtyRef,
      drainTerrainFetchQueue,
    });
  }

  function finishTerrainFetch(key: string) {
    finishTerrainFetchManaged({
      key,
      activeTerrainFetchCountRef,
      terrainFetchControllersRef,
      drainTerrainFetchQueue,
    });
  }

  function drainTerrainFetchQueue() {
    drainTerrainFetchQueueManaged({
      pendingTerrainFetchQueueRef,
      activeTerrainFetchCountRef,
      maxConcurrentTerrainFetches:
        debugSettingsRef.current.maxConcurrentTerrainFetches,
      activeTerrainRequestKeysRef,
      loadedTerrainRef,
      loadingTerrainRef,
      terrainFetchControllersRef,
      fetchTerrainTile: (request, controller) => {
        void fetchTerrainTile(request, controller);
      },
    });
  }

  async function fetchTerrainTile(
    request: PendingTerrainFetchRequest,
    controller: AbortController,
  ) {
    await fetchTerrainTileManaged({
      request,
      controller,
      queryClient: queryClientRef.current,
      activeTerrainRequestKeysRef,
      loadedTerrainRef,
      loadingTerrainRef,
      pendingTerrainMeshQueueRef,
      onFinally: finishTerrainFetch,
    });
  }

  function buildQueuedTerrainMeshesForFrame() {
    return buildQueuedTerrainMeshesManaged({
      pendingTerrainMeshQueueRef,
      maxTerrainMeshesPerFrame:
        debugSettingsRef.current.maxTerrainMeshesPerFrame,
      terrainMeshBuildBudgetMs:
        debugSettingsRef.current.terrainMeshBuildBudgetMs,
      activeTerrainRequestKeysRef,
      loadedTerrainRef,
      loadingTerrainRef,
      terrainGroup: terrainGroupRef.current,
      chunkBorderGroup: chunkBorderGroupRef.current,
      terrainMaterial,
      showChunkBorders: showChunkBordersRef.current,
      ensureTerrainBorderAssets,
      debugLabelsDirtyRef,
      biomeLabelsDirtyRef,
      terrainVisibilityDirtyRef,
    });
  }

  function evictWarmCachedVoxelTile(key: string) {
    evictWarmCachedVoxelTileManaged(
      key,
      warmCachedVoxelsRef.current,
      warmCachedVoxelBytesRef,
      voxelGroupRef.current,
      chunkBorderGroupRef.current,
    );
  }

  function moveVoxelTileToWarmCache(tile: LoadedVoxelTile) {
    moveVoxelTileToWarmCacheManaged({
      tile,
      warmCachedVoxels: warmCachedVoxelsRef.current,
      warmCachedVoxelBytesRef,
      warmVoxelCacheMaxBytes: debugSettingsRef.current.warmVoxelCacheLimitBytes,
      voxelGroup: voxelGroupRef.current,
      chunkBorderGroup: chunkBorderGroupRef.current,
    });
  }

  function restoreVoxelTileFromWarmCache(key: string): LoadedVoxelTile | null {
    return restoreVoxelTileFromWarmCacheManaged({
      key,
      warmCachedVoxels: warmCachedVoxelsRef.current,
      warmCachedVoxelBytesRef,
      voxelGroup: voxelGroupRef.current,
      chunkBorderGroup: chunkBorderGroupRef.current,
      isVoxelTileStale,
    });
  }

  function unloadVoxelTile(key: string, preserveWarmCache = true) {
    const vt = loadedVoxelsRef.current.get(key);
    if (!vt) return;
    loadedVoxelsRef.current.delete(key);
    loadingVoxelsRef.current.delete(key);
    voxelUnloadGraceUntilRef.current.delete(key);
    biomeLabelsDirtyRef.current = true;

    if (preserveWarmCache) {
      moveVoxelTileToWarmCache(vt);
      return;
    }

    disposeVoxelTileResourcesManaged(
      vt,
      voxelGroupRef.current,
      chunkBorderGroupRef.current,
    );
  }

  function clearVoxelTiles(preserveWarmCache = false) {
    clearVoxelTilesManaged({
      preserveWarmCache,
      loadedVoxels: loadedVoxelsRef.current,
      voxelFetchControllers: voxelFetchControllersRef.current,
      loadingVoxels: loadingVoxelsRef.current,
      missingVoxels: missingVoxelsRef.current,
      failedVoxels: failedVoxelsRef.current,
      activeVoxelRequestKeys: activeVoxelRequestKeysRef.current,
      voxelRefreshStates: voxelRefreshStatesRef.current,
      pendingVoxelDetailRequests: pendingVoxelDetailRequestsRef.current,
      committedVoxelDetailRequests: committedVoxelDetailRequestsRef.current,
      voxelUnloadGraceUntil: voxelUnloadGraceUntilRef.current,
      voxelLastCameraSampleRef,
      voxelLastMotionAtRef,
      pendingVoxelFetchQueueRef,
      pendingVoxelMeshQueueRef,
      activeVoxelFetchCountRef,
      warmCachedVoxels: warmCachedVoxelsRef.current,
      warmCachedVoxelBytesRef,
      unloadVoxelTile,
      evictWarmCachedVoxelTile,
    });
  }

  function updateTerrainVisibility(target: THREE.Vector3, camDist: number) {
    updateTerrainVisibilityManaged({
      target,
      camDist,
      showTerrainUnderlay: showTerrainUnderlayRef.current,
      loadedTerrain: loadedTerrainRef.current,
      loadingTerrain: loadingTerrainRef.current,
      terrainLodHysteresisRatio:
        debugSettingsRef.current.terrainLodHysteresisRatio,
      activeFocusLod: activeTerrainLodRef.current,
      ensureTerrainBorderAssets,
      showChunkBorders: showChunkBordersRef.current,
      loadedVoxels: loadedVoxelsRef.current.values(),
    });
  }

  function syncTerrainLod(target: THREE.Vector3, camDist: number) {
    const now = performance.now();
    const terrainRequestGeneration =
      activeTerrainRequestGenerationRef.current + 1;
    activeTerrainRequestGenerationRef.current = terrainRequestGeneration;
    const stableForDetail =
      now - voxelLastMotionAtRef.current >=
      debugSettingsRef.current.voxelDetailRequestDebounceMs;

    syncTerrainLodManaged({
      target,
      camDist,
      surfaceIndex: surfaceIndexRef.current,
      loadedTerrain: loadedTerrainRef.current,
      loadingTerrain: loadingTerrainRef.current,
      syncTerrainRequests,
      disposeTerrainTile,
      updateTerrainVisibility,
      debugLabelsDirtyRef,
      biomeLabelsDirtyRef,
      terrainVisibilityDirtyRef,
      activeFocusLodRef: activeTerrainLodRef,
      terrainLodHysteresisRatio:
        debugSettingsRef.current.terrainLodHysteresisRatio,
      terrainRequestGeneration,
      stableForDetail,
    });
  }

  function queueVoxelFetchRequest(request: PendingVoxelFetchRequest) {
    queueVoxelFetchRequestManaged(pendingVoxelFetchQueueRef.current, request);
  }

  function getVoxelRefreshVersion(key: string): number {
    return getVoxelRefreshVersionManaged(voxelRefreshStatesRef.current, key);
  }

  function markVoxelTileStale(key: string): number {
    return markVoxelTileStaleManaged(voxelRefreshStatesRef.current, key);
  }

  function markVoxelTileFresh(key: string, version: number) {
    markVoxelTileFreshManaged(voxelRefreshStatesRef.current, key, version);
  }

  function isVoxelTileStale(key: string): boolean {
    return isVoxelTileStaleManaged(voxelRefreshStatesRef.current, key);
  }

  function finishVoxelFetch(key: string) {
    finishVoxelFetchManaged(
      key,
      voxelFetchControllersRef,
      activeVoxelFetchCountRef,
      drainVoxelFetchQueue,
    );
  }

  function requestDirectVoxelRefresh(
    lod: number,
    regionX: number,
    regionY: number,
    version: number,
  ) {
    requestDirectVoxelRefreshManaged({
      lod,
      regionX,
      regionY,
      version,
      worker: workerRef.current,
      failedVoxels: failedVoxelsRef.current,
      maxVoxelRetries: MAX_VOXEL_RETRIES,
      voxelFetchControllers: voxelFetchControllersRef.current,
      activeVoxelFetchCountRef,
      loadingVoxels: loadingVoxelsRef.current,
      fetchVoxelRegion: (request, controller) => {
        void fetchVoxelRegion(request, controller);
      },
      activeVoxelRequestGeneration: activeVoxelRequestGenerationRef.current,
    });
  }

  function requestVoxelRegion(request: PendingVoxelFetchRequest) {
    requestVoxelRegionManaged({
      request,
      loadedVoxels: loadedVoxelsRef.current,
      isVoxelTileStale,
      restoreVoxelTileFromWarmCache,
      voxelUnloadGraceUntil: voxelUnloadGraceUntilRef.current,
      voxelUnloadGraceMs: debugSettingsRef.current.voxelUnloadGraceMs,
      markVoxelTileFresh,
      debugLabelsDirtyRef,
      missingVoxels: missingVoxelsRef.current,
      failedVoxels: failedVoxelsRef.current,
      maxVoxelRetries: MAX_VOXEL_RETRIES,
      worker: workerRef.current,
      voxelFetchControllers: voxelFetchControllersRef.current,
      loadingVoxels: loadingVoxelsRef.current,
      queueVoxelFetchRequest,
      biomeLabelsDirtyRef,
    });
  }

  function drainVoxelFetchQueue() {
    drainVoxelFetchQueueManaged({
      pendingVoxelFetchQueueRef,
      activeVoxelFetchCountRef,
      maxConcurrentVoxelFetches:
        debugSettingsRef.current.maxConcurrentVoxelFetches,
      activeVoxelRequestKeys: activeVoxelRequestKeysRef.current,
      loadedVoxels: loadedVoxelsRef.current,
      isVoxelTileStale,
      missingVoxels: missingVoxelsRef.current,
      failedVoxels: failedVoxelsRef.current,
      maxVoxelRetries: MAX_VOXEL_RETRIES,
      voxelFetchControllers: voxelFetchControllersRef.current,
      loadingVoxels: loadingVoxelsRef.current,
      fetchVoxelRegion: (request, controller) => {
        void fetchVoxelRegion(request, controller);
      },
    });
  }

  function syncVoxelRequests(requests: Map<string, PendingVoxelFetchRequest>) {
    syncVoxelRequestsManaged({
      requests,
      activeVoxelRequestKeysRef,
      pendingVoxelFetchQueueRef,
      pendingVoxelMeshQueueRef,
      loadedVoxelsRef,
      loadingVoxelsRef,
      voxelFetchControllersRef,
      isVoxelTileStale,
      getVoxelRefreshVersion,
      requestVoxelRegion,
      drainVoxelFetchQueue,
    });
  }

  async function fetchVoxelRegion(
    request: PendingVoxelFetchRequest,
    controller: AbortController,
  ) {
    await fetchVoxelRegionManaged({
      request,
      controller,
      workerRef,
      activeVoxelRequestKeysRef,
      loadedVoxelsRef,
      loadingVoxelsRef,
      missingVoxelsRef,
      failedVoxelsRef,
      isVoxelTileStale,
      onFinally: finishVoxelFetch,
      includeHaloEmitters:
        debugSettingsRef.current.voxelHaloEmittersEnabled > 0,
      bakeEmissiveAttributes:
        debugSettingsRef.current.voxelEmissiveAttributesEnabled > 0,
    });
  }

  function updateVoxelLod(
    focusLod: number,
    cameraPosition: THREE.Vector3,
    referenceSurfaceZ: number,
    cameraForward: THREE.Vector3,
    screenSpaceDistanceScale: number,
    cameraFov: number,
    viewportHeight: number,
    focusPoint: THREE.Vector3 | null,
  ) {
    updateVoxelLodManaged({
      focusLod,
      cameraPosition,
      referenceSurfaceZ,
      cameraForward,
      screenSpaceDistanceScale,
      cameraFov,
      viewportHeight,
      focusPoint,
      voxelRootEntries: voxelRootEntriesRef.current,
      availableVoxelKeys: availableVoxelKeysRef.current,
      loadedVoxels: loadedVoxelsRef.current,
      loadingVoxels: loadingVoxelsRef.current,
      pendingVoxelMeshQueue: pendingVoxelMeshQueueRef.current,
      voxelUnloadGraceUntil: voxelUnloadGraceUntilRef.current,
      voxelThresholds: voxelLodThresholdsRef.current,
      renderDistance,
      minRenderedVoxelLod,
      activeVoxelRequestGenerationRef,
      voxelLastMotionAt: voxelLastMotionAtRef.current,
      voxelDetailRequestDebounceMs:
        debugSettingsRef.current.voxelDetailRequestDebounceMs,
      debugSettings: {
        voxelBehindCameraDotStart:
          debugSettingsRef.current.voxelBehindCameraDotStart,
        voxelBehindCameraMaxMultiplier:
          debugSettingsRef.current.voxelBehindCameraMaxMultiplier,
        lodUnloadHysteresis: debugSettingsRef.current.lodUnloadHysteresis,
        voxelLodHysteresisRatio:
          debugSettingsRef.current.voxelLodHysteresisRatio,
        voxelTopAoIntensity: debugSettingsRef.current.voxelTopAoIntensity,
        voxelWallAoIntensity: debugSettingsRef.current.voxelWallAoIntensity,
        voxelUnloadGraceMs: debugSettingsRef.current.voxelUnloadGraceMs,
      },
      pendingVoxelDetailRequestsRef,
      committedVoxelDetailRequestsRef,
      getVoxelRefreshVersion,
      isVoxelTileStale,
      unloadVoxelTile,
      syncVoxelRequests,
      debugLabelsDirtyRef,
    });
  }

  async function refreshBiomeLabels(target: THREE.Vector3, camDist: number) {
    const token = ++biomeRefreshTokenRef.current;
    await refreshBiomeLabelsManaged({
      target,
      camDist,
      showBiomeLabels: showBiomeLabelsRef.current,
      group: biomeLabelGroupRef.current,
      labelMap: biomeLabelMapRef.current,
      queryClient: queryClientRef.current,
      surfaceIndex: surfaceIndexRef.current,
      loadedTerrain: loadedTerrainRef.current.values(),
      loadedVoxels: loadedVoxelsRef.current.values(),
      token,
      getCurrentToken: () => biomeRefreshTokenRef.current,
    });
  }

  function syncSignLayer() {
    const manager = signLayerRef.current;
    const scene = sceneRef.current;
    if (!manager || !scene) return;
    if (!manager.isAttached()) {
      manager.attachTo(scene.scene);
    }
    manager.sync(loadedVoxelsRef.current.keys());
  }

  function refreshDebugLabels() {
    refreshDebugLabelsManaged({
      group: debugLabelGroupRef.current,
      labelMap: debugLabelMapRef.current,
      debugEnabled: debugEnabledRef.current,
      showTiles: showChunkBordersRef.current,
      showHeights: showVoxelHeightLabelsRef.current,
      loadedTerrain: loadedTerrainRef.current.values(),
      loadedVoxels: loadedVoxelsRef.current.values(),
    });
  }

  function addSpawnMarker() {
    rebuildSpawnMarker({
      spawn: worldDataRef.current.worldData?.spawn,
      spawnGroup: spawnGroupRef.current,
      createMarkerDot,
      createMarkerLabel,
      disposeTextSprite,
    });
  }

  function resolveLoadedAvatarModelId(player: PlayerData): string | null {
    const cache = avatarAssetCacheRef.current;
    const own = player.entityModelId;
    if (own) {
      const ownEntry = cache.get(own);
      if (ownEntry?.state === "loaded") {
        return own;
      }
    }
    // Fall back to the default avatar when the player's own model is not
    // loadable but the default is available.
    const defaultEntry = cache.get(DEFAULT_AVATAR_MODEL_ID);
    if (defaultEntry?.state === "loaded") {
      return DEFAULT_AVATAR_MODEL_ID;
    }
    return null;
  }

  function updatePlayerMarkers() {
    const cache = avatarAssetCacheRef.current;
    syncPlayerMarkers({
      players: playersRef.current,
      markerGroup: markerGroupRef.current,
      resolvePlayerMarker: (player) => {
        const avatarModelId = resolveLoadedAvatarModelId(player);
        if (!avatarModelId) {
          return { object: null, avatarModelId: null };
        }
        const entry = cache.get(avatarModelId);
        if (
          !entry ||
          entry.state !== "loaded" ||
          !entry.template ||
          !entry.activeTexture ||
          !entry.inactiveTexture
        ) {
          return { object: null, avatarModelId: null };
        }
        const object = createPlayerMarkerModel(
          entry.template,
          player.isActive ? entry.activeTexture : entry.inactiveTexture,
          player.position[2] < 0,
        );
        return { object, avatarModelId };
      },
      getPlayerMarkerIdentity: (player) => {
        const avatarModelId = resolveLoadedAvatarModelId(player);
        return { usesModel: avatarModelId !== null, avatarModelId };
      },
      createFormattedPlayerLabel,
      disposePlayerMarkerModel,
      disposeTextSprite,
    });
  }

  const onUpdatePlayerMarkers = useEffectEvent(updatePlayerMarkers);

  function updateMarkerScales(_: THREE.PerspectiveCamera, __: OrbitControls) {
    // Marker labels are CSS2D-based and intentionally keep constant screen size,
    // matching biome labels readability across zoom levels.
    const scene = sceneRef.current;
    const markerGroup = markerGroupRef.current;
    if (!scene) {
      return;
    }

    updatePlayerMarkerScale(markerGroup, (root) => {
      const markerDistance = Math.max(
        1,
        TEMP_TO_MARKER.copy(root.position).sub(scene.camera.position).length(),
      );
      return THREE.MathUtils.clamp(
        (markerDistance / PLAYER_MARKER_SCALE_REFERENCE_DISTANCE) *
          PLAYER_MARKER_BASE_SCALE,
        PLAYER_MARKER_MIN_SCALE,
        PLAYER_MARKER_MAX_SCALE,
      );
    });
  }

  function handleTileUpdate(lod: number, tileX: number, tileY: number) {
    handleTerrainTileUpdate({
      lod,
      tileX,
      tileY,
      queryClient: queryClientRef.current,
      showTerrainUnderlay: showTerrainUnderlayRef.current,
      loadedTerrain: loadedTerrainRef.current,
      evictWarmCachedTerrainTile,
      queueTerrainTileLoad,
      disposeTerrainTile: (tile) => disposeTerrainTile(tile, false),
      debugLabelsDirtyRef,
      biomeLabelsDirtyRef,
    });
  }

  function handleWorldUpdate() {
    queryClientRef.current.removeQueries({ queryKey: ["signs"] });
    signLayerRef.current?.clear();
    syncSignLayer();
  }

  function handleRegionUpdate(lod: number, regionX: number, regionY: number) {
    signLayerRef.current?.invalidateRegion(regionX, regionY);
    handleVoxelRegionUpdate({
      lod,
      regionX,
      regionY,
      scene: sceneRef.current,
      loadedVoxels: loadedVoxelsRef.current,
      availableVoxelKeys: availableVoxelKeysRef.current,
      missingVoxels: missingVoxelsRef.current,
      failedVoxels: failedVoxelsRef.current,
      loadingVoxels: loadingVoxelsRef.current,
      voxelFetchControllers: voxelFetchControllersRef.current,
      pendingVoxelFetchQueueRef,
      pendingVoxelMeshQueueRef,
      markVoxelTileStale,
      getVoxelRefreshVersion,
      evictWarmCachedVoxelTile,
      requestDirectVoxelRefresh,
      checkAndUpdateLOD,
      debugLabelsDirtyRef,
      biomeLabelsDirtyRef,
    });
  }

  function checkAndUpdateLOD(
    camera: THREE.PerspectiveCamera,
    controls: OrbitControls,
  ) {
    const referenceSurfaceZ = getReferenceSurfaceZ(
      camera.position,
      loadedVoxelsRef.current,
      worldDataRef.current.worldData?.spawn?.[2],
    );
    const viewportHeight = containerRef.current?.clientHeight ?? 0;
    const screenSpaceDistanceScale = computeScreenSpaceDistanceScale(
      camera.fov,
      viewportHeight,
      debugSettingsRef.current.lodReferenceFov,
      debugSettingsRef.current.lodReferenceViewportHeight,
    );

    checkAndUpdateLodManaged({
      camera,
      controls,
      showTerrainUnderlay: showTerrainUnderlayRef.current,
      voxelLastCameraSampleRef,
      voxelLastMotionAtRef,
      pendingVoxelDetailRequestsRef,
      committedVoxelDetailRequestsRef,
      syncVoxelRequests,
      activeFocusLodRef,
      referenceSurfaceZ,
      screenSpaceDistanceScale,
      viewportHeight,
      syncTerrainLod,
      updateTerrainVisibility,
      terrainVisibilityDirtyRef,
      resolveVoxelLodFocus: (
        activeCamera,
        activeControls,
        cameraForward,
        activeReferenceSurfaceZ,
      ) =>
        resolveVoxelLodFocus({
          camera: activeCamera,
          controls: activeControls,
          voxelGroup: voxelGroupRef.current,
          loadedVoxels: loadedVoxelsRef.current,
          cameraForward,
          referenceSurfaceZ: activeReferenceSurfaceZ,
          voxelBehindCameraDotStart:
            debugSettingsRef.current.voxelBehindCameraDotStart,
          voxelBehindCameraMaxMultiplier:
            debugSettingsRef.current.voxelBehindCameraMaxMultiplier,
          state: voxelFocusStateRef.current,
          stickyMs: debugSettingsRef.current.voxelFocusStickyMs,
          smoothAlpha: debugSettingsRef.current.voxelFocusSmoothAlpha,
          activeFocusLod: activeFocusLodRef.current,
          voxelLodThresholds: voxelLodThresholdsRef.current,
        }),
      voxelLodThresholds: voxelLodThresholdsRef.current,
      minRenderedVoxelLod,
      voxelLodHysteresisRatio: debugSettingsRef.current.voxelLodHysteresisRatio,
      updateVoxelLod,
      debugLabelsDirtyRef,
      biomeLabelsDirtyRef,
      refreshDebugLabels,
      refreshBiomeLabels,
      onShareStateChange: (state) => {
        onShareStateChangeRef.current(state);
      },
    });
    syncSignLayer();
  }

  function retargetInitialCameraToVisibleSurface() {
    const state = pendingInitialSurfaceRetargetRef.current;
    if (!state || !sceneRef.current) return false;

    const retargeted = retargetCameraStateToVisibleSurface({
      camera: sceneRef.current.camera,
      controls: sceneRef.current.controls,
      initialCameraState: state,
      terrainGroup: terrainGroupRef.current,
      voxelGroup: voxelGroupRef.current,
    });
    if (!retargeted) return false;

    pendingInitialSurfaceRetargetRef.current = null;
    terrainVisibilityDirtyRef.current = true;
    debugLabelsDirtyRef.current = true;
    biomeLabelsDirtyRef.current = true;
    return true;
  }

  function handleWorkerMessage(data: WorkerOut) {
    handleVoxelWorkerMessage({
      data,
      getVoxelRefreshVersion,
      activeVoxelRequestKeys: activeVoxelRequestKeysRef.current,
      loadedVoxels: loadedVoxelsRef.current,
      loadingVoxels: loadingVoxelsRef.current,
      failedVoxels: failedVoxelsRef.current,
      pendingVoxelMeshQueueRef,
      isVoxelTileStale,
      onBenchmarkSample: (sample) => {
        const current = voxelBenchmarkRef.current;
        const nextSamples = current.samples + 1;
        const cacheOutcome = sample.cacheOutcome ?? "unknown";
        voxelBenchmarkRef.current = {
          samples: nextSamples,
          contentEncoding: sample.contentEncoding,
          avgFetchMs:
            (current.avgFetchMs * current.samples + sample.fetchMs) /
            nextSamples,
          avgDecodeMs:
            (current.avgDecodeMs * current.samples + sample.decodeMs) /
            nextSamples,
          avgTotalMs:
            (current.avgTotalMs * current.samples + sample.totalMs) /
            nextSamples,
          avgTransferBytes: averageNullableMetric(
            current.avgTransferBytes,
            current.samples,
            sample.transferBytes,
            nextSamples,
          ),
          avgEncodedBodyBytes: averageNullableMetric(
            current.avgEncodedBodyBytes,
            current.samples,
            sample.encodedBodyBytes,
            nextSamples,
          ),
          avgDecodedBodyBytes: averageNullableMetric(
            current.avgDecodedBodyBytes,
            current.samples,
            sample.decodedBodyBytes,
            nextSamples,
          ),
          avgRawBufferBytes: averageNullableMetric(
            current.avgRawBufferBytes,
            current.samples,
            sample.rawBufferBytes,
            nextSamples,
          ),
          avgWorkerOutputBytes: averageNullableMetric(
            current.avgWorkerOutputBytes,
            current.samples,
            sample.workerOutputBytes,
            nextSamples,
          ),
          avgEmissiveBytes: averageNullableMetric(
            current.avgEmissiveBytes,
            current.samples,
            sample.emissiveBytes,
            nextSamples,
          ),
          avgServerRunMs: averageNullableMetric(
            current.avgServerRunMs,
            current.samples,
            sample.serverRunMs,
            nextSamples,
          ),
          avgServerHaloMs: averageNullableMetric(
            current.avgServerHaloMs,
            current.samples,
            sample.serverHaloMs,
            nextSamples,
          ),
          cacheHitSamples:
            current.cacheHitSamples + (cacheOutcome === "hit" ? 1 : 0),
          cacheMissSamples:
            current.cacheMissSamples + (cacheOutcome === "miss" ? 1 : 0),
          cacheUnknownSamples:
            current.cacheUnknownSamples + (cacheOutcome === "unknown" ? 1 : 0),
          haloEmittersEnabled: current.haloEmittersEnabled,
          emissiveAttributesEnabled: current.emissiveAttributesEnabled,
        };
      },
    });
  }

  function buildQueuedVoxelMeshesForFrame(
    renderer: THREE.WebGLRenderer,
    preUploadTarget: THREE.WebGLRenderTarget,
    preUploadScene: THREE.Scene,
    preUploadCamera: THREE.Camera,
  ) {
    return buildQueuedVoxelMeshes({
      pendingVoxelMeshQueueRef,
      maxVoxelMeshesPerFrame: debugSettingsRef.current.maxVoxelMeshesPerFrame,
      voxelMeshBuildBudgetMs: debugSettingsRef.current.voxelMeshBuildBudgetMs,
      getVoxelRefreshVersion,
      activeVoxelRequestKeys: activeVoxelRequestKeysRef.current,
      loadedVoxels: loadedVoxelsRef.current,
      loadingVoxels: loadingVoxelsRef.current,
      isVoxelTileStale,
      voxelGroup: voxelGroupRef.current,
      chunkBorderGroup: chunkBorderGroupRef.current,
      renderer,
      preUploadTarget,
      preUploadScene,
      preUploadCamera,
      voxelMaterial,
      transparentVoxelMaterial,
      markVoxelTileFresh,
      failedVoxels: failedVoxelsRef.current,
      missingVoxels: missingVoxelsRef.current,
      debugLabelsDirtyRef,
      biomeLabelsDirtyRef,
      disposeVoxelTileResources: (tile) => {
        disposeVoxelTileResourcesManaged(
          tile,
          voxelGroupRef.current,
          chunkBorderGroupRef.current,
        );
      },
    });
  }

  function publishCurrentChunkStats(fpsValue: number) {
    publishChunkStats({
      fpsValue,
      activeFocusLod: activeFocusLodRef.current,
      loadingTerrain: loadingTerrainRef.current,
      loadingVoxels: loadingVoxelsRef.current,
      pendingVoxelFetchQueue: pendingVoxelFetchQueueRef.current,
      pendingVoxelMeshQueue: pendingVoxelMeshQueueRef.current,
      missingVoxels: missingVoxelsRef.current,
      failedVoxels: failedVoxelsRef.current,
      loadedTerrain: loadedTerrainRef.current,
      loadedVoxels: loadedVoxelsRef.current,
      warmCachedTerrain: warmCachedTerrainRef.current,
      warmCachedVoxels: warmCachedVoxelsRef.current,
      voxelBenchmark: voxelBenchmarkRef.current,
      blockLightStats: blockLightStatsRef.current,
      lastChunkStatsRef,
      onChunkStatsChange: (stats) => {
        onChunkStatsChangeRef.current(stats);
      },
    });
  }

  function publishCurrentLoadingBreakdown() {
    const nextLoadingBreakdown = {
      terrain: loadingTerrainRef.current.size,
      voxels: loadingVoxelsRef.current.size,
      fetchQueue: pendingVoxelFetchQueueRef.current.length,
      meshQueue: pendingVoxelMeshQueueRef.current.length,
    };

    const prev = lastPublishedLoadingBreakdownRef.current;
    if (
      prev.terrain === nextLoadingBreakdown.terrain &&
      prev.voxels === nextLoadingBreakdown.voxels &&
      prev.fetchQueue === nextLoadingBreakdown.fetchQueue &&
      prev.meshQueue === nextLoadingBreakdown.meshQueue
    ) {
      return;
    }
    lastPublishedLoadingBreakdownRef.current = nextLoadingBreakdown;
    onLoadingBreakdownChangeRef.current(nextLoadingBreakdown);
  }

  function hasPendingSceneWork() {
    return (
      activeTerrainFetchCountRef.current > 0 ||
      activeVoxelFetchCountRef.current > 0 ||
      loadingTerrainRef.current.size > 0 ||
      loadingVoxelsRef.current.size > 0 ||
      pendingTerrainFetchQueueRef.current.length > 0 ||
      pendingTerrainMeshQueueRef.current.length > 0 ||
      pendingVoxelFetchQueueRef.current.length > 0 ||
      pendingVoxelMeshQueueRef.current.length > 0
    );
  }

  useWorld3DSceneRuntime({
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
    showTerrainUnderlayRef,
    showChunkBordersRef,
    showBiomeLabelsRef,
    debugEnabledRef,
    debugSettingsRef,
    keysHeldRef,
    terrainLoadGenerationRef,
    worldDataRef,
    loadedVoxelsRef,
    blockLightStatsRef,
    onCursorMoveRef,
    onPlayerClickRef,
    terrainVisibilityDirtyRef,
    debugLabelsDirtyRef,
    biomeLabelsDirtyRef,
    updateMarkerScales,
    handleWorkerMessage,
    buildQueuedTerrainMeshes: buildQueuedTerrainMeshesForFrame,
    buildQueuedVoxelMeshes: buildQueuedVoxelMeshesForFrame,
    retargetInitialCameraToVisibleSurface,
    checkAndUpdateLOD,
    updateTerrainVisibility,
    refreshDebugLabels,
    clearDebugLabels,
    refreshBiomeLabels,
    publishChunkStats: publishCurrentChunkStats,
    publishLoadingBreakdown: publishCurrentLoadingBreakdown,
    hasPendingSceneWork,
    clearTerrainTiles,
    clearVoxelTiles,
    clearBiomeLabels,
    terrainMaterial,
    voxelMaterial,
    transparentVoxelMaterial,
  });

  useWorld3DInitialization({
    initializedRef,
    sceneRef,
    terrainGroupRef,
    voxelGroupRef,
    worldDataLoading: worldData.loading,
    surfaceIndex: worldData.surfaceIndex,
    chunkIndex: worldData.chunkIndex,
    spawn: worldData.worldData?.spawn,
    surfaceIndexRef,
    chunkIndexRef,
    rebuildVoxelIndexState: rebuildVoxelIndexCache,
    initialCameraState,
    pendingInitialSurfaceRetargetRef,
    addSpawnMarker,
    updatePlayerMarkers,
    checkAndUpdateLOD,
  });

  useWorld3DChunkStatsReset({
    onChunkStatsChangeRef,
  });

  useWorld3DSceneSyncEffects({
    surfaceIndex: worldData.surfaceIndex,
    chunkIndex: worldData.chunkIndex,
    showTerrainUnderlay,
    sceneRef,
    surfaceIndexRef,
    chunkIndexRef,
    rebuildVoxelIndexState: rebuildVoxelIndexCache,
    missingVoxelsRef,
    failedVoxelsRef,
    clearTerrainTiles,
    terrainIndexVersionRef,
    checkAndUpdateLOD,
  });

  useWorld3DDisplayEffects({
    players,
    showPlayers,
    showSpawn,
    showChunkBorders,
    showTerrainUnderlay,
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
    clearTerrainTiles,
    checkAndUpdateLOD,
  });

  useWorld3DUpdateSubscription({
    subscribe,
    handleTileUpdate,
    handleRegionUpdate,
    handleWorldUpdate,
  });

  useWorld3DFlyToEffect({
    flyToRequest,
    sceneRef,
    terrainGroupRef,
    voxelGroupRef,
  });

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        background: "#1a1a2e",
      }}
    />
  );
}

function getReferenceSurfaceZ(
  cameraPosition: THREE.Vector3,
  loadedVoxels: Map<string, LoadedVoxelTile>,
  fallbackZ: number | undefined,
): number {
  let referenceSurfaceZ = Number.NEGATIVE_INFINITY;

  for (const tile of loadedVoxels.values()) {
    const size = regionWorldSize(tile.lod);
    const containsCamera =
      cameraPosition.x >= tile.regionX &&
      cameraPosition.x <= tile.regionX + size &&
      cameraPosition.y >= tile.regionY &&
      cameraPosition.y <= tile.regionY + size;
    if (containsCamera) {
      const chunkWorldSize = VOXEL_CHUNK_CELLS * tile.voxelSize;
      const chunkX = Math.floor(
        (cameraPosition.x - tile.regionX) / chunkWorldSize,
      );
      const chunkY = Math.floor(
        (cameraPosition.y - tile.regionY) / chunkWorldSize,
      );
      const localTopZ =
        chunkX >= 0 && chunkX <= 3 && chunkY >= 0 && chunkY <= 3
          ? tile.chunkTopHeights[chunkX * 4 + chunkY]
          : undefined;
      const surfaceZ =
        typeof localTopZ === "number" && Number.isFinite(localTopZ)
          ? localTopZ
          : tile.maxZ;
      const implausibleHighSurface =
        typeof fallbackZ === "number" &&
        Number.isFinite(fallbackZ) &&
        surfaceZ > fallbackZ + 512 &&
        cameraPosition.z - surfaceZ < 512;
      if (
        Number.isFinite(surfaceZ) &&
        surfaceZ <= cameraPosition.z &&
        !implausibleHighSurface
      ) {
        referenceSurfaceZ = Math.max(referenceSurfaceZ, surfaceZ);
      }
    }
  }

  if (Number.isFinite(referenceSurfaceZ)) {
    return referenceSurfaceZ;
  }

  return typeof fallbackZ === "number" && Number.isFinite(fallbackZ)
    ? fallbackZ
    : 0;
}

function averageNullableMetric(
  currentAverage: number | null,
  currentSamples: number,
  nextValue: number | null,
  nextSamples: number,
): number | null {
  if (nextValue === null) {
    return currentAverage;
  }
  if (currentAverage === null || currentSamples === 0) {
    return nextValue;
  }
  return (currentAverage * currentSamples + nextValue) / nextSamples;
}
