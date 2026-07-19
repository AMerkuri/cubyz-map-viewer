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
  handleVoxelRegionUpdates,
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
  addVoxelBenchmarkSample,
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
  PendingVoxelCompactInput,
  PendingVoxelEnhancementInput,
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
  createVoxelAdaptiveState,
  selectVoxelWorkerProfile,
  updateVoxelAdaptiveTarget,
} from "../lib/voxel-adaptive-workers.js";
import { attachVoxelEmissiveEnhancement } from "../lib/voxel-builders.js";
import {
  disposeVoxelTileResources as disposeVoxelTileResourcesManaged,
  evictWarmCachedVoxelTile as evictWarmCachedVoxelTileManaged,
  moveVoxelTileToWarmCache as moveVoxelTileToWarmCacheManaged,
  restoreVoxelTileFromWarmCache as restoreVoxelTileFromWarmCacheManaged,
} from "../lib/voxel-cache.js";
import { resolveVoxelLodFocus } from "../lib/voxel-focus.js";
import { rebuildVoxelIndex, voxelTileKey } from "../lib/voxel-index.js";
import {
  fetchVoxelRegion as fetchVoxelRegionManaged,
  finishVoxelFetch as finishVoxelFetchManaged,
  getVoxelRefreshVersion as getVoxelRefreshVersionManaged,
  isVoxelTileStale as isVoxelTileStaleManaged,
  markVoxelTileFresh as markVoxelTileFreshManaged,
  markVoxelTileStale as markVoxelTileStaleManaged,
  queueVoxelFetchRequest as queueVoxelFetchRequestManaged,
  scheduleVoxelCapacityRetry,
  syncVoxelRequests as syncVoxelRequestsManaged,
} from "../lib/voxel-requests.js";
import {
  buildQueuedVoxelMeshes,
  clearVoxelTiles as clearVoxelTilesManaged,
  drainVoxelFetchQueue as drainVoxelFetchQueueManaged,
  handleVoxelWorkerMessage,
  isVoxelEnhancementTargetValid,
  requestDirectVoxelRefresh as requestDirectVoxelRefreshManaged,
  requestVoxelRegion as requestVoxelRegionManaged,
  updateVoxelLod as updateVoxelLodManaged,
} from "../lib/voxel-runtime.js";
import {
  classifyVoxelView,
  getReferenceVoxelViewBounds,
} from "../lib/voxel-view.js";
import {
  getVoxelSafetyClass,
  type VoxelViewClass,
  VoxelWorkScheduler,
} from "../lib/voxel-work.js";
import { VoxelOutputEstimator } from "../lib/voxel-worker-capacity.js";
import type { VoxelWorkerPool } from "../lib/voxel-worker-pool.js";

const PLAYER_MARKER_BASE_SCALE = 4;
const PLAYER_MARKER_SCALE_REFERENCE_DISTANCE = 200;
const PLAYER_MARKER_MIN_SCALE = 1;
const PLAYER_MARKER_MAX_SCALE = 100;
const CHUNK_STATS_PUBLISH_INTERVAL_MS = 250;
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
  const loadedVoxelsRevisionRef = useRef(0);
  const warmCachedVoxelsRef = useRef<Map<string, WarmCachedVoxelTile>>(
    new Map(),
  );
  const warmCachedVoxelBytesRef = useRef(0);
  const loadingVoxelsRef = useRef<Set<string>>(new Set());
  const missingVoxelsRef = useRef<Set<string>>(new Set());
  const failedVoxelsRef = useRef<Map<string, number>>(new Map());
  const voxelRetryNotBeforeRef = useRef<Map<string, number>>(new Map());
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
  const voxelViewClassesRef = useRef(new Map<string, VoxelViewClass>());
  const pendingVoxelMeshQueueRef = useRef<PendingVoxelMeshItem[]>([]);
  const voxelWorkSchedulerRef = useRef<
    VoxelWorkScheduler<
      PendingVoxelCompactInput | PendingVoxelEnhancementInput,
      PendingVoxelMeshItem | WorkerOut
    >
  >(
    new VoxelWorkScheduler(
      {
        maxJobs: debugSettings.voxelCompactInputMaxJobs,
        maxBytes: debugSettings.voxelCompactInputMaxBytes,
      },
      {
        maxJobs: debugSettings.voxelExpandedOutputMaxJobs,
        maxBytes: debugSettings.voxelExpandedOutputMaxBytes,
      },
      256,
      {
        maxJobs: debugSettings.voxelRetainedEnhancementMaxJobs,
        maxBytes: debugSettings.voxelRetainedEnhancementMaxBytes,
      },
    ),
  );
  voxelWorkSchedulerRef.current.setLimits(
    {
      maxJobs: debugSettings.voxelCompactInputMaxJobs,
      maxBytes: debugSettings.voxelCompactInputMaxBytes,
    },
    {
      maxJobs: debugSettings.voxelExpandedOutputMaxJobs,
      maxBytes: debugSettings.voxelExpandedOutputMaxBytes,
    },
    {
      maxJobs: debugSettings.voxelRetainedEnhancementMaxJobs,
      maxBytes: debugSettings.voxelRetainedEnhancementMaxBytes,
    },
  );
  const workerPoolRef = useRef<VoxelWorkerPool<WorkerOut> | null>(null);
  const voxelOutputEstimatorRef = useRef(new VoxelOutputEstimator());
  const initialWorkerProfile = selectVoxelWorkerProfile({
    coarsePointer: null,
    deviceMemoryGb: null,
    staticOne: debugSettings.voxelWorkerTarget === 1,
  });
  const voxelAdaptiveStateRef = useRef(
    createVoxelAdaptiveState(initialWorkerProfile),
  );
  const voxelAdaptiveProfileRef = useRef(initialWorkerProfile);
  const voxelAdaptiveProfileClassRef = useRef(initialWorkerProfile.class);
  const voxelWorkerDurationSamplesRef = useRef<number[]>([]);
  const nextBaseMeshIdRef = useRef(1);
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
  const lastPublishedChunkStatsAtRef = useRef(0);
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
  const progressiveBaseOutputBytesRef = useRef<Map<string, number>>(new Map());
  // Debug-only voxel-lighting diagnostics: reset benchmark averages whenever
  // the active diagnostic matrix state changes so samples from different
  // matrix cells are never averaged together.
  const diagnosticsMatrixKey = `${debugSettings.voxelHaloEmittersEnabled > 0 ? 1 : 0}:${debugSettings.voxelEmissiveAttributesEnabled > 0 ? 1 : 0}:${debugSettings.voxelProgressiveMeshingEnabled > 0 ? 1 : 0}`;
  const lastDiagnosticsMatrixKeyRef = useRef(diagnosticsMatrixKey);
  if (lastDiagnosticsMatrixKeyRef.current !== diagnosticsMatrixKey) {
    lastDiagnosticsMatrixKeyRef.current = diagnosticsMatrixKey;
    voxelBenchmarkRef.current = createEmptyVoxelBenchmarkStats(
      debugSettings.voxelHaloEmittersEnabled > 0,
      debugSettings.voxelEmissiveAttributesEnabled > 0,
    );
    progressiveBaseOutputBytesRef.current.clear();
  }
  const blockLightStatsRef = useRef<BlockLightRuntimeStats>({
    decodedEmitters: 0,
    activeEmitters: 0,
    budget: 0,
    glowBudget: 0,
    pointLightBudget: 0,
    glowPoolAllocated: 0,
    glowPoolUsed: 0,
    pointLightPoolAllocated: 0,
    poolMemoryBytes: 0,
    runtimeMs: 0,
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
  const voxelLastCameraSampleRef = useRef<{
    camera: THREE.Vector3;
    target: THREE.Vector3;
  } | null>(null);
  const voxelLastMotionAtRef = useRef(performance.now());

  function isVoxelDetailStable(now = performance.now()): boolean {
    return (
      now - voxelLastMotionAtRef.current >=
      debugSettingsRef.current.voxelDetailRequestDebounceMs
    );
  }

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
    const tile = restoreVoxelTileFromWarmCacheManaged({
      key,
      warmCachedVoxels: warmCachedVoxelsRef.current,
      warmCachedVoxelBytesRef,
      voxelGroup: voxelGroupRef.current,
      chunkBorderGroup: chunkBorderGroupRef.current,
      isVoxelTileStale,
    });
    if (tile) tile.baseMeshId = nextBaseMeshIdRef.current++;
    return tile;
  }

  function unloadVoxelTile(key: string, preserveWarmCache = true) {
    const vt = loadedVoxelsRef.current.get(key);
    if (!vt) return;
    loadedVoxelsRef.current.delete(key);
    loadedVoxelsRevisionRef.current++;
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
    voxelViewClassesRef.current.clear();
    for (const record of voxelWorkSchedulerRef.current.cancelAll("shutdown")) {
      if (record.stage === "meshing") {
        const workerId = record.workerId;
        workerPoolRef.current?.postToWorker(workerId ?? -1, {
          type: "cancel",
          jobId: record.jobId,
          phase: record.phase,
          version: record.version,
          ...(record.baseMeshId === null
            ? {}
            : { baseMeshId: record.baseMeshId }),
        });
        voxelWorkSchedulerRef.current.finish(
          record.jobId,
          "cancelled",
          "shutdown",
        );
      }
    }
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
      pendingVoxelFetchQueueRef,
      pendingVoxelMeshQueueRef,
      activeVoxelFetchCountRef,
      warmCachedVoxels: warmCachedVoxelsRef.current,
      warmCachedVoxelBytesRef,
      unloadVoxelTile,
      evictWarmCachedVoxelTile,
    });
    voxelLastCameraSampleRef.current = null;
    voxelLastMotionAtRef.current = performance.now();
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
    const terrainRequestGeneration =
      activeTerrainRequestGenerationRef.current + 1;
    activeTerrainRequestGenerationRef.current = terrainRequestGeneration;
    const stableForDetail = isVoxelDetailStable();

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

  function hasValidEnhancementTarget(
    key: string,
    targetRefreshVersion: number,
    scheduledBaseMeshId: number | null,
    targetBaseMeshId = scheduledBaseMeshId,
  ): boolean {
    const tile = loadedVoxelsRef.current.get(key);
    return (
      targetBaseMeshId !== null &&
      isVoxelEnhancementTargetValid({
        currentRefreshVersion: getVoxelRefreshVersion(key),
        targetRefreshVersion,
        stale: isVoxelTileStale(key),
        loadedBaseMeshId: tile?.baseMeshId ?? null,
        targetBaseMeshId,
        scheduledBaseMeshId,
      })
    );
  }

  function finishVoxelFetch(key: string) {
    for (const record of voxelWorkSchedulerRef.current.getByKey(key)) {
      if (record.stage === "fetching") {
        voxelWorkSchedulerRef.current.finish(
          record.jobId,
          record.cancellationReason ? "cancelled" : "error",
        );
      }
    }
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
    const key = voxelTileKey(lod, regionX, regionY);
    const loadedTile = loadedVoxelsRef.current.get(key);
    const scene = sceneRef.current;
    const worldSize = regionWorldSize(lod);
    const cameraPosition = scene?.camera.position ?? new THREE.Vector3();
    const bounds = loadedTile
      ? {
          minX: regionX,
          maxX: regionX + worldSize,
          minY: regionY,
          maxY: regionY + worldSize,
          minZ: loadedTile.minZ,
          maxZ: loadedTile.maxZ,
        }
      : getReferenceVoxelViewBounds({
          regionX,
          regionY,
          worldSize,
          referenceSurfaceZ: getReferenceSurfaceZ(
            cameraPosition,
            loadedVoxelsRef.current,
            worldDataRef.current.worldData?.spawn?.[2],
          ),
        });
    const center = new THREE.Vector3(
      (bounds.minX + bounds.maxX) / 2,
      (bounds.minY + bounds.maxY) / 2,
      (bounds.minZ + bounds.maxZ) / 2,
    );
    const distance = cameraPosition.distanceTo(center);
    const viewportHeight = containerRef.current?.clientHeight ?? 0;
    const viewportAspect =
      (containerRef.current?.clientWidth ?? 0) / Math.max(1, viewportHeight);
    const viewClass = scene
      ? classifyVoxelView({
          cameraPosition,
          cameraDirection: scene.camera.getWorldDirection(new THREE.Vector3()),
          verticalFovDegrees: scene.camera.fov,
          viewportAspect,
          bounds,
          enterMarginDegrees:
            debugSettingsRef.current.voxelViewEnterMarginDegrees,
          exitMarginDegrees:
            debugSettingsRef.current.voxelViewExitMarginDegrees,
          previousClass: voxelViewClassesRef.current.get(key),
        })
      : (voxelViewClassesRef.current.get(key) ?? "rear");
    voxelViewClassesRef.current.set(key, viewClass);
    const projectedBenefit =
      distance > 0 && viewportHeight > 0 && scene
        ? (worldSize / distance) *
          (viewportHeight / (2 * Math.tan((scene.camera.fov * Math.PI) / 360)))
        : 0;
    requestDirectVoxelRefreshManaged({
      lod,
      regionX,
      regionY,
      version,
      failedVoxels: failedVoxelsRef.current,
      maxVoxelRetries: MAX_VOXEL_RETRIES,
      loadingVoxels: loadingVoxelsRef.current,
      queueVoxelFetchRequest: (queuedRequest) => {
        voxelWorkSchedulerRef.current.markFetchQueued(
          queuedRequest.key,
          queuedRequest.version,
        );
        queueVoxelFetchRequest(queuedRequest);
      },
      voxelRetryNotBefore: voxelRetryNotBeforeRef.current,
      drainVoxelFetchQueue,
      activeVoxelRequestGeneration: activeVoxelRequestGenerationRef.current,
      priority: {
        coverageClass: loadedTile ? "detail" : "coverage",
        safetyClass: getVoxelSafetyClass(
          loadedTile ? "detail" : "coverage",
          viewClass,
        ),
        viewClass,
        phase: "base",
        projectedBenefit,
        distance,
        lod,
        generation: activeVoxelRequestGenerationRef.current,
        demandSince: performance.now(),
        sequence: activeVoxelRequestGenerationRef.current,
      },
    });
  }

  function requestVoxelRegion(request: PendingVoxelFetchRequest) {
    requestVoxelRegionManaged({
      request,
      loadedVoxels: loadedVoxelsRef.current,
      isVoxelTileStale,
      restoreVoxelTileFromWarmCache,
      onVoxelTileRestored: () => loadedVoxelsRevisionRef.current++,
      voxelUnloadGraceUntil: voxelUnloadGraceUntilRef.current,
      voxelUnloadGraceMs: debugSettingsRef.current.voxelUnloadGraceMs,
      markVoxelTileFresh,
      debugLabelsDirtyRef,
      missingVoxels: missingVoxelsRef.current,
      failedVoxels: failedVoxelsRef.current,
      maxVoxelRetries: MAX_VOXEL_RETRIES,
      workerAvailable: (workerPoolRef.current?.activeCount ?? 0) > 0,
      voxelFetchControllers: voxelFetchControllersRef.current,
      loadingVoxels: loadingVoxelsRef.current,
      queueVoxelFetchRequest,
      voxelRetryNotBefore: voxelRetryNotBeforeRef.current,
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
      canStartFetch: () => voxelWorkSchedulerRef.current.canStartFetch(),
      fetchVoxelRegion: (request, controller) => {
        voxelWorkSchedulerRef.current.createFetching({
          key: request.key,
          version: request.version,
          priority: request.priority,
          selectedAt: request.selectedAt,
          fetchStartedAt: performance.now(),
        });
        void fetchVoxelRegion(request, controller);
      },
    });
  }

  function dispatchNextVoxelWork() {
    const pool = workerPoolRef.current;
    if (!pool) return;
    pool.dispatchToIdle((workerId, worker) => {
      const now = performance.now();
      const record = voxelWorkSchedulerRef.current.dispatchNext(
        now,
        workerId,
        (candidate) => {
          const input = candidate.compact;
          return input
            ? voxelOutputEstimatorRef.current.estimate({
                phase: candidate.phase,
                lod: input.lod,
                buffer: input.buffer,
              })
            : 0;
        },
        { activeWorkerCount: pool.activeCount },
      );
      const input = record?.compact;
      if (!record || !input) return false;
      const progressive =
        debugSettingsRef.current.voxelProgressiveMeshingEnabled > 0;
      const message =
        record.phase === "enhancement"
          ? {
              type: "enhancement" as const,
              phase: "enhancement" as const,
              jobId: record.jobId,
              buffer: input.buffer,
              lod: input.lod,
              regionX: input.regionX,
              regionY: input.regionY,
              version: record.version,
              baseMeshId: record.baseMeshId ?? -1,
              benchmark: input.benchmark,
              cancellationCheckpointMs:
                debugSettingsRef.current.voxelCancellationCheckpointMs,
            }
          : {
              type: progressive ? ("base" as const) : ("mesh" as const),
              phase: "base" as const,
              jobId: record.jobId,
              buffer: input.buffer,
              lod: input.lod,
              regionX: input.regionX,
              regionY: input.regionY,
              version: record.version,
              cancellationCheckpointMs:
                debugSettingsRef.current.voxelCancellationCheckpointMs,
              bakeEmissiveAttributes:
                "bakeEmissiveAttributes" in input
                  ? input.bakeEmissiveAttributes
                  : false,
              benchmark: "benchmark" in input ? input.benchmark : undefined,
            };
      worker.postMessage(message, [input.buffer]);
      return true;
    });
    drainVoxelFetchQueue();
  }

  function cancelVoxelWork(
    key: string,
    reason: "demand-removed" | "refresh-superseded",
    olderThanVersion = Number.POSITIVE_INFINITY,
    jobId?: number,
  ) {
    const cancelled = jobId
      ? [voxelWorkSchedulerRef.current.cancel(jobId, reason)].filter(
          (record) => record !== null,
        )
      : voxelWorkSchedulerRef.current.cancelKey(key, reason, olderThanVersion);
    for (const record of cancelled) {
      if (reason === "demand-removed" && record.phase === "base") {
        loadingVoxelsRef.current.delete(record.key);
      }
      if (record.stage === "fetching") {
        voxelFetchControllersRef.current.get(key)?.abort();
      } else if (record.stage === "meshing") {
        workerPoolRef.current?.postToWorker(record.workerId ?? -1, {
          type: "cancel",
          jobId: record.jobId,
          phase: record.phase,
          version: record.version,
          ...(record.baseMeshId === null
            ? {}
            : { baseMeshId: record.baseMeshId }),
        });
      } else if (record.stage === "expanded-output") {
        pendingVoxelMeshQueueRef.current =
          pendingVoxelMeshQueueRef.current.filter(
            (item) => item.jobId !== record.jobId,
          );
      }
    }
    dispatchNextVoxelWork();
    drainVoxelFetchQueue();
  }

  function syncVoxelRequests(requests: Map<string, PendingVoxelFetchRequest>) {
    const now = performance.now();
    voxelWorkSchedulerRef.current.reconcileDemand(
      new Map(
        [...requests].map(([key, request]) => {
          const retryNotBefore = voxelRetryNotBeforeRef.current.get(key);
          const demandState =
            loadedVoxelsRef.current.has(key) && !isVoxelTileStale(key)
              ? "fresh"
              : missingVoxelsRef.current.has(key)
                ? "known-missing"
                : (failedVoxelsRef.current.get(key) ?? 0) >= MAX_VOXEL_RETRIES
                  ? "retry-exhausted"
                  : retryNotBefore !== undefined && retryNotBefore > now
                    ? "retry-delayed"
                    : "executable";
          return [key, { ...request, demandState }];
        }),
      ),
      now,
    );
    for (const record of [...voxelWorkSchedulerRef.current.records.values()]) {
      const updated = requests.get(record.key);
      const refreshRequired =
        loadedVoxelsRef.current.has(record.key) && isVoxelTileStale(record.key);
      if (record.phase === "enhancement") {
        if (
          !hasValidEnhancementTarget(
            record.key,
            record.version,
            record.baseMeshId,
          )
        ) {
          cancelVoxelWork(
            record.key,
            "demand-removed",
            Number.POSITIVE_INFINITY,
            record.jobId,
          );
        }
        continue;
      }
      if (!updated && !refreshRequired) {
        cancelVoxelWork(
          record.key,
          "demand-removed",
          Number.POSITIVE_INFINITY,
          record.jobId,
        );
      } else if (updated && record.version < updated.version) {
        cancelVoxelWork(record.key, "refresh-superseded", updated.version);
        loadingVoxelsRef.current.add(updated.key);
        queueVoxelFetchRequest(updated);
      } else if (updated) {
        voxelWorkSchedulerRef.current.reprioritize(
          record.jobId,
          updated.priority,
        );
      }
    }
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
    dispatchNextVoxelWork();
  }

  async function fetchVoxelRegion(
    request: PendingVoxelFetchRequest,
    controller: AbortController,
  ) {
    await fetchVoxelRegionManaged({
      request,
      controller,
      activeVoxelRequestKeysRef,
      loadedVoxelsRef,
      loadingVoxelsRef,
      missingVoxelsRef,
      failedVoxelsRef,
      isVoxelTileStale,
      onFinally: finishVoxelFetch,
      onCompactInput: (completedRequest, input) => {
        const record = voxelWorkSchedulerRef.current
          .getByKey(completedRequest.key)
          .find(
            (candidate) =>
              candidate.stage === "fetching" &&
              candidate.version === completedRequest.version,
          );
        if (
          record &&
          voxelWorkSchedulerRef.current.acceptCompact(
            record.jobId,
            input,
            input.buffer.byteLength,
            performance.now(),
          )
        ) {
          dispatchNextVoxelWork();
        }
      },
      onCapacityRetry: (delayedRequest, retryAfterMs) => {
        scheduleVoxelCapacityRetry({
          request: delayedRequest,
          retryAfterMs,
          retryNotBeforeRef: voxelRetryNotBeforeRef,
          activeVoxelRequestKeysRef,
          loadedVoxelsRef,
          isVoxelTileStale,
          requestVoxelRegion,
        });
      },
      onDemandState: (completedRequest, state) => {
        voxelWorkSchedulerRef.current.markDemandState(
          completedRequest.key,
          completedRequest.version,
          state,
        );
      },
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
    viewportAspect: number,
    focusPoint: THREE.Vector3 | null,
    stableForDetail: boolean,
  ) {
    updateVoxelLodManaged({
      focusLod,
      cameraPosition,
      referenceSurfaceZ,
      cameraForward,
      screenSpaceDistanceScale,
      cameraFov,
      viewportHeight,
      viewportAspect,
      focusPoint,
      voxelRootEntries: voxelRootEntriesRef.current,
      availableVoxelKeys: availableVoxelKeysRef.current,
      loadedVoxels: loadedVoxelsRef.current,
      warmCachedVoxels: warmCachedVoxelsRef.current,
      loadingVoxels: loadingVoxelsRef.current,
      pendingVoxelMeshQueue: pendingVoxelMeshQueueRef.current,
      voxelUnloadGraceUntil: voxelUnloadGraceUntilRef.current,
      voxelThresholds: voxelLodThresholdsRef.current,
      renderDistance,
      minRenderedVoxelLod,
      activeVoxelRequestGenerationRef,
      stableForDetail,
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
        voxelViewEnterMarginDegrees:
          debugSettingsRef.current.voxelViewEnterMarginDegrees,
        voxelViewExitMarginDegrees:
          debugSettingsRef.current.voxelViewExitMarginDegrees,
      },
      voxelViewClasses: voxelViewClassesRef.current,
      pendingVoxelDetailRequestsRef,
      committedVoxelDetailRequestsRef,
      getVoxelRefreshVersion,
      isVoxelTileStale,
      unloadVoxelTile,
      syncVoxelRequests,
      debugLabelsDirtyRef,
      onVoxelVisible: (key, visibleAt) => {
        const record = voxelWorkSchedulerRef.current
          .getByKey(key)
          .find((candidate) => candidate.stage === "inserted");
        if (record) {
          voxelWorkSchedulerRef.current.markFirstVisible(
            record.jobId,
            visibleAt,
          );
        }
      },
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

  function handleRegionUpdates(
    regions: Array<{ lod: number; regionX: number; regionY: number }>,
  ) {
    for (const region of regions) {
      signLayerRef.current?.invalidateRegion(region.regionX, region.regionY);
    }
    handleVoxelRegionUpdates({
      regions,
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
      cancelVoxelWork: (key, olderThanVersion) => {
        cancelVoxelWork(key, "refresh-superseded", olderThanVersion);
      },
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
    const viewportAspect =
      (containerRef.current?.clientWidth ?? 0) / Math.max(1, viewportHeight);
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
      voxelDetailRequestDebounceMs:
        debugSettingsRef.current.voxelDetailRequestDebounceMs,
      pendingVoxelDetailRequestsRef,
      committedVoxelDetailRequestsRef,
      syncVoxelRequests,
      activeFocusLodRef,
      referenceSurfaceZ,
      screenSpaceDistanceScale,
      viewportHeight,
      viewportAspect,
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

  function handleWorkerMessage(workerId: number, data: WorkerOut) {
    workerPoolRef.current?.complete(workerId);
    voxelWorkerDurationSamplesRef.current.push(
      Math.max(0, data.timing.completedAt - data.timing.startedAt),
    );
    const resultReceivedAt = performance.now();
    const record = voxelWorkSchedulerRef.current.records.get(data.jobId);
    if (
      !record ||
      record.stage !== "meshing" ||
      record.version !== data.version ||
      record.cancellationReason
    ) {
      if (record) {
        if (record.cancellationReason === "demand-removed") {
          loadingVoxelsRef.current.delete(record.key);
        }
        const cancelledResultRace =
          (data.type === "mesh-result" ||
            data.type === "base-result" ||
            data.type === "enhancement-result") &&
          record.cancellationReason !== undefined;
        voxelWorkSchedulerRef.current.finish(
          record.jobId,
          cancelledResultRace
            ? "discarded"
            : record.cancellationReason
              ? "cancelled"
              : "discarded",
          cancelledResultRace
            ? "cancel-race"
            : (record.cancellationReason ?? "result-validation"),
        );
      }
      dispatchNextVoxelWork();
      drainVoxelFetchQueue();
      return;
    }
    if (
      data.phase === "enhancement" &&
      (data.type === "cancelled" || data.type === "error")
    ) {
      voxelWorkSchedulerRef.current.finish(
        data.jobId,
        data.type === "cancelled" ? "cancelled" : "error",
        data.type === "cancelled" ? "worker-cancelled" : "worker-error",
      );
      dispatchNextVoxelWork();
      drainVoxelFetchQueue();
      return;
    }
    if (data.type === "enhancement-result") {
      const bytes = data.quadrantEnhancements.reduce(
        (sum, quadrant) => sum + quadrant.emissiveColors.byteLength,
        0,
      );
      voxelOutputEstimatorRef.current.observeActual(
        record.phase,
        record.priority.lod,
        record.compactBytes,
        bytes,
      );
      const accepted = voxelWorkSchedulerRef.current.completeWorker(
        data.jobId,
        data,
        bytes,
        {
          workerStartedAt: data.timing.startedAt - performance.timeOrigin,
          workerCompletedAt: data.timing.completedAt - performance.timeOrigin,
          resultReceivedAt,
        },
      );
      const current =
        accepted &&
        hasValidEnhancementTarget(
          record.key,
          data.version,
          record.baseMeshId,
          data.baseMeshId,
        );
      const tile = loadedVoxelsRef.current.get(record.key);
      if (
        current &&
        tile &&
        attachVoxelEmissiveEnhancement(tile, data.quadrantEnhancements)
      ) {
        voxelWorkSchedulerRef.current.markEnhancementAttached(
          data.jobId,
          performance.now(),
        );
      } else {
        voxelWorkSchedulerRef.current.finish(
          data.jobId,
          "discarded",
          accepted ? "enhancement-target-mismatch" : "result-validation",
        );
      }
      if (data.benchmark) {
        const baseOutputBytes = progressiveBaseOutputBytesRef.current.get(
          `${record.key}:${data.version}`,
        );
        progressiveBaseOutputBytesRef.current.delete(
          `${record.key}:${data.version}`,
        );
        voxelBenchmarkRef.current = addVoxelBenchmarkSample(
          voxelBenchmarkRef.current,
          {
            ...data.benchmark,
            totalMs: data.benchmark.fetchMs + data.benchmark.decodeMs,
            baseWorkerOutputBytes: baseOutputBytes ?? null,
            enhancementWorkerOutputBytes: data.benchmark.workerOutputBytes,
            combinedWorkerOutputBytes:
              baseOutputBytes === undefined
                ? null
                : baseOutputBytes + data.benchmark.workerOutputBytes,
          },
        );
      }
      dispatchNextVoxelWork();
      drainVoxelFetchQueue();
      return;
    }
    handleVoxelWorkerMessage({
      data,
      getVoxelRefreshVersion,
      activeVoxelRequestKeys: activeVoxelRequestKeysRef.current,
      loadedVoxels: loadedVoxelsRef.current,
      loadingVoxels: loadingVoxelsRef.current,
      failedVoxels: failedVoxelsRef.current,
      pendingVoxelMeshQueueRef,
      isVoxelTileStale,
      getWorkPriority: (jobId) =>
        voxelWorkSchedulerRef.current.records.get(jobId)?.priority ?? null,
      acceptMeshResult: (item, bytes) => {
        voxelOutputEstimatorRef.current.observeActual(
          record.phase,
          record.priority.lod,
          record.compactBytes,
          bytes,
        );
        const accepted = voxelWorkSchedulerRef.current.completeWorker(
          item.jobId,
          item,
          bytes,
          {
            workerStartedAt: data.timing.startedAt - performance.timeOrigin,
            workerCompletedAt: data.timing.completedAt - performance.timeOrigin,
            resultReceivedAt,
          },
        );
        if (
          !accepted ||
          (data.type !== "mesh-result" && data.type !== "base-result") ||
          !data.benchmark
        ) {
          return accepted;
        }
        if (data.type === "base-result" && data.enhancementBuffer) {
          progressiveBaseOutputBytesRef.current.set(
            `${item.key}:${item.version}`,
            data.benchmark.workerOutputBytes,
          );
          return accepted;
        }
        voxelBenchmarkRef.current = addVoxelBenchmarkSample(
          voxelBenchmarkRef.current,
          {
            ...data.benchmark,
            totalMs: data.benchmark.fetchMs + data.benchmark.decodeMs,
            baseWorkerOutputBytes: data.benchmark.workerOutputBytes,
            combinedWorkerOutputBytes: data.benchmark.workerOutputBytes,
          },
        );
        return accepted;
      },
    });
    if (
      (data.type === "mesh-result" || data.type === "base-result") &&
      voxelWorkSchedulerRef.current.records.get(data.jobId)?.stage === "meshing"
    ) {
      voxelWorkSchedulerRef.current.finish(
        data.jobId,
        "discarded",
        "result-validation",
      );
    }
    if (data.type === "cancelled" || data.type === "error") {
      voxelWorkSchedulerRef.current.finish(
        data.jobId,
        data.type === "cancelled" ? "cancelled" : "error",
      );
    }
    dispatchNextVoxelWork();
    drainVoxelFetchQueue();
  }

  function handleWorkerError(workerId: number) {
    const failed = voxelWorkSchedulerRef.current.failWorker(workerId);
    for (const record of failed) {
      loadingVoxelsRef.current.delete(record.key);
      failedVoxelsRef.current.set(
        record.key,
        (failedVoxelsRef.current.get(record.key) ?? 0) + 1,
      );
    }
    dispatchNextVoxelWork();
    drainVoxelFetchQueue();
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
      getWorkPriority: (jobId) =>
        voxelWorkSchedulerRef.current.records.get(jobId)?.priority ?? null,
      disposeVoxelTileResources: (tile) => {
        disposeVoxelTileResourcesManaged(
          tile,
          voxelGroupRef.current,
          chunkBorderGroupRef.current,
        );
      },
      onVoxelTileLoaded: () => loadedVoxelsRevisionRef.current++,
      allocateBaseMeshId: () => nextBaseMeshIdRef.current++,
      onVoxelMeshFinished: (item, outcome) => {
        if (outcome === "loaded") {
          voxelWorkSchedulerRef.current.markSceneInserted(
            item.jobId,
            performance.now(),
          );
          const tile = loadedVoxelsRef.current.get(item.key);
          const baseRecord = voxelWorkSchedulerRef.current.records.get(
            item.jobId,
          );
          if (item.enhancementBuffer && tile && baseRecord) {
            voxelWorkSchedulerRef.current.createRetainedEnhancement({
              key: item.key,
              version: item.version,
              priority: baseRecord.priority,
              selectedAt: baseRecord.timestamps.selectedAt,
              retainedAt: performance.now(),
              compact: {
                buffer: item.enhancementBuffer,
                lod: item.lod,
                regionX: item.regionX,
                regionY: item.regionY,
                baseMeshId: tile.baseMeshId,
                benchmark: item.benchmark,
              },
              compactBytes: item.enhancementBuffer.byteLength,
              baseMeshId: tile.baseMeshId,
            });
            item.enhancementBuffer = null;
          }
          if (!loadedVoxelsRef.current.has(item.key)) {
            voxelWorkSchedulerRef.current.finish(item.jobId, "loaded");
          }
        } else {
          voxelWorkSchedulerRef.current.finish(
            item.jobId,
            outcome,
            outcome === "error" ? "scene-error" : "scene-validation",
          );
        }
        dispatchNextVoxelWork();
        drainVoxelFetchQueue();
      },
    });
  }

  function publishCurrentChunkStats(fpsValue: number) {
    const now = performance.now();
    if (
      now - lastPublishedChunkStatsAtRef.current <
      CHUNK_STATS_PUBLISH_INTERVAL_MS
    ) {
      return;
    }
    lastPublishedChunkStatsAtRef.current = now;
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
      voxelPipeline: {
        snapshot: voxelWorkSchedulerRef.current.snapshot(),
        diagnostics: voxelWorkSchedulerRef.current.getDiagnostics(now),
        retainedEnhancementCapacity: {
          jobs: debugSettingsRef.current.voxelRetainedEnhancementMaxJobs,
          bytes: debugSettingsRef.current.voxelRetainedEnhancementMaxBytes,
        },
        expandedOutputCapacity: {
          jobs: debugSettingsRef.current.voxelExpandedOutputMaxJobs,
          bytes: debugSettingsRef.current.voxelExpandedOutputMaxBytes,
        },
        adaptive: {
          profile: voxelAdaptiveProfileClassRef.current,
          limiterReason: voxelAdaptiveStateRef.current.limiterReason,
          diagnostics: voxelAdaptiveStateRef.current.diagnostics,
        },
      },
      blockLightStats: blockLightStatsRef.current,
      lastChunkStatsRef,
      onChunkStatsChange: (stats) => {
        onChunkStatsChangeRef.current(stats);
      },
    });
  }

  function observeVoxelFrame(frameTimeMs: number) {
    const snapshot = voxelWorkSchedulerRef.current.snapshot();
    const pool = workerPoolRef.current;
    if (!pool) return;
    const configuredTarget = Math.floor(
      debugSettingsRef.current.voxelWorkerTarget,
    );
    const profile = selectVoxelWorkerProfile({
      coarsePointer:
        typeof window.matchMedia === "function"
          ? window.matchMedia("(pointer: coarse)").matches
          : null,
      deviceMemoryGb:
        (navigator as Navigator & { deviceMemory?: number }).deviceMemory ??
        null,
      staticOne: configuredTarget === 1,
    });
    const heap = (
      performance as Performance & {
        memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
      }
    ).memory;
    if (voxelAdaptiveProfileClassRef.current !== profile.class) {
      voxelAdaptiveProfileClassRef.current = profile.class;
      voxelAdaptiveProfileRef.current = profile;
      voxelAdaptiveStateRef.current = createVoxelAdaptiveState(
        profile,
        performance.now(),
      );
    }
    if (configuredTarget > 0) {
      pool.setTarget(Math.min(configuredTarget, profile.maxWorkers));
    } else {
      const now = performance.now();
      const executableBasePressure =
        voxelWorkSchedulerRef.current.getExecutableBasePressure(now);
      voxelAdaptiveStateRef.current = updateVoxelAdaptiveTarget(
        voxelAdaptiveStateRef.current,
        {
          now,
          executableBaseJobs: executableBasePressure.jobs,
          oldestExecutableBaseAgeMs: executableBasePressure.oldestAgeMs,
          frameTimeMs,
          workerBusyRatio: pool.busyCount / Math.max(1, pool.activeCount),
          workerDurationMs: voxelWorkerDurationSamplesRef.current.shift(),
          sceneBacklogJobs: snapshot.expandedOutput.jobs,
          sceneBacklogBytes: snapshot.expandedOutput.bytes,
          reservedBytes: snapshot.reservedExpandedOutput.bytes,
          expandedBytes: snapshot.expandedOutput.bytes,
          memoryPressure: heap
            ? heap.usedJSHeapSize / Math.max(1, heap.jsHeapSizeLimit)
            : null,
          interacting: !isVoxelDetailStable(),
        },
        profile,
      );
      pool.setTarget(voxelAdaptiveStateRef.current.targetWorkers);
    }
    voxelWorkSchedulerRef.current.observeRuntime({
      frameTimeMs,
      workerBusy: pool.busyCount / Math.max(1, pool.activeCount),
      reservedExpandedBytes: snapshot.reservedExpandedOutput.bytes,
      activeWorkers: pool.activeCount,
      targetWorkers: pool.targetCount,
    });
    dispatchNextVoxelWork();
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
    workerPoolRef,
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
    loadedVoxelsRevisionRef,
    blockLightStatsRef,
    onCursorMoveRef,
    onPlayerClickRef,
    terrainVisibilityDirtyRef,
    debugLabelsDirtyRef,
    biomeLabelsDirtyRef,
    updateMarkerScales,
    handleWorkerMessage,
    handleWorkerError,
    buildQueuedTerrainMeshes: buildQueuedTerrainMeshesForFrame,
    buildQueuedVoxelMeshes: buildQueuedVoxelMeshesForFrame,
    retargetInitialCameraToVisibleSurface,
    checkAndUpdateLOD,
    updateTerrainVisibility,
    refreshDebugLabels,
    clearDebugLabels,
    refreshBiomeLabels,
    publishChunkStats: publishCurrentChunkStats,
    observeVoxelFrame,
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
    resetVoxelLoadGeneration: () => {
      voxelWorkSchedulerRef.current.resetLoadGeneration();
      voxelAdaptiveStateRef.current = createVoxelAdaptiveState(
        voxelAdaptiveProfileRef.current,
        performance.now(),
      );
    },
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
    handleRegionUpdates,
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
