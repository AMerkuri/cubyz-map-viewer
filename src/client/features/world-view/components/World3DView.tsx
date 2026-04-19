import type { QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useRef } from "react";
import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type {
  CSS2DObject,
  CSS2DRenderer,
} from "three/addons/renderers/CSS2DRenderer.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import {
  createEmptyLoadingBreakdown,
  type LoadingBreakdown,
} from "../../../lib/world-view-debug.js";
import type {
  ChunkIndexEntry,
  SurfaceIndexEntry,
} from "../hooks/useWorldData.js";
import { refreshBiomeLabels as refreshBiomeLabelsManaged } from "../lib/biome-labels.js";
import { MAX_VOXEL_RETRIES } from "../lib/constants.js";
import {
  clearCssLabelMap,
  refreshDebugLabels as refreshDebugLabelsManaged,
} from "../lib/debug-overlays.js";
import {
  handleTerrainTileUpdate,
  handleVoxelRegionUpdate,
} from "../lib/live-updates.js";
import { checkAndUpdateLod as checkAndUpdateLodManaged } from "../lib/lod-controller.js";
import { createVoxelLodDistanceThresholds } from "../lib/lod-utils.js";
import {
  rebuildSpawnMarker,
  syncPlayerMarkers,
  updatePlayerMarkerScale,
} from "../lib/markers.js";
import {
  createFormattedPlayerLabel,
  createGrayscaleTexture,
  createMarkerDot,
  createMarkerLabel,
  createPlayerMarkerModel,
  disposePlayerMarkerModel,
  disposePlayerMarkerTemplate,
  disposeTextSprite,
} from "../lib/primitives.js";
import type { RollingVoxelBenchmarkStats } from "../lib/stats.js";
import { publishChunkStats } from "../lib/stats.js";
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

export type { InitialCameraState } from "../lib/types.js";

const PLAYER_MARKER_BASE_SCALE = 4;
const PLAYER_MARKER_SCALE_REFERENCE_DISTANCE = 200;
const PLAYER_MARKER_MIN_SCALE = 1;
const PLAYER_MARKER_MAX_SCALE = 100;
const TEMP_TO_MARKER = new THREE.Vector3();

export function World3DView({
  mode,
  worldData,
  players,
  subscribe,
  showPlayers,
  showSpawn,
  showChunkBorders,
  showTerrain,
  showVoxelTerrain,
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

  const voxelMaterialRef = useRef<THREE.MeshLambertMaterial | null>(null);
  if (!voxelMaterialRef.current) {
    voxelMaterialRef.current = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.FrontSide,
    });
  }

  const terrainMaterial = terrainMaterialRef.current;
  const voxelMaterial = voxelMaterialRef.current;

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
  const modeRef = useRef(mode);
  modeRef.current = mode;

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
  const showTerrainRef = useRef(showTerrain);
  showTerrainRef.current = showTerrain;
  const showVoxelTerrainRef = useRef(showVoxelTerrain);
  showVoxelTerrainRef.current = showVoxelTerrain;
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
  const voxelBenchmarkRef = useRef<RollingVoxelBenchmarkStats>({
    samples: 0,
    contentEncoding: null,
    avgFetchMs: 0,
    avgDecodeMs: 0,
    avgTotalMs: 0,
    avgTransferBytes: null,
    avgEncodedBodyBytes: null,
    avgDecodedBodyBytes: null,
    avgRawBufferBytes: null,
  });
  const playerMarkerModelTemplateRef = useRef<THREE.Object3D | null>(null);
  const playerMarkerTextureRef = useRef<THREE.Texture | null>(null);
  const playerMarkerGrayscaleTextureRef = useRef<THREE.Texture | null>(null);
  const playerAssetsLoadIdRef = useRef(0);
  const playerAssetsLoadingRef = useRef(false);
  const playerAssetsLoadedRef = useRef(false);
  const playerAssetsRetryAttemptRef = useRef(0);
  const playerAssetsRetryTimerRef = useRef<number | null>(null);
  const activeFocusLodRef = useRef<number>(1);
  const activeTerrainLodRef = useRef<number>(1);
  const voxelFocusStateRef = useRef<VoxelFocusState>({
    point: new THREE.Vector3(),
    zoomDist: 0,
    lastSampleAt: 0,
    initialized: false,
  });

  useEffect(() => {
    const shouldLoadPlayerAssets = showPlayers || players.length > 0;
    if (!shouldLoadPlayerAssets || playerAssetsLoadedRef.current) {
      return;
    }

    if (playerAssetsLoadingRef.current) {
      return;
    }

    const loadId = ++playerAssetsLoadIdRef.current;
    let cancelled = false;
    const textureLoader = new THREE.TextureLoader();
    const objLoader = new OBJLoader();

    async function loadPlayerAssets() {
      if (playerAssetsLoadingRef.current || playerAssetsLoadedRef.current) {
        return;
      }

      playerAssetsLoadingRef.current = true;
      try {
        const [textureResult, modelResult] = await Promise.allSettled([
          textureLoader.loadAsync("/api/assets/entities/textures/snale.png"),
          objLoader.loadAsync("/api/assets/entities/models/snale.obj"),
        ]);

        if (cancelled || loadId !== playerAssetsLoadIdRef.current) {
          if (textureResult.status === "fulfilled") {
            textureResult.value.dispose();
          }
          if (modelResult.status === "fulfilled") {
            disposePlayerMarkerTemplate(modelResult.value);
          }
          return;
        }

        if (
          textureResult.status === "fulfilled" &&
          modelResult.status === "fulfilled"
        ) {
          textureResult.value.colorSpace = THREE.SRGBColorSpace;
          textureResult.value.magFilter = THREE.NearestFilter;
          textureResult.value.minFilter = THREE.NearestFilter;
          playerMarkerTextureRef.current?.dispose();
          playerMarkerGrayscaleTextureRef.current?.dispose();
          playerMarkerTextureRef.current = textureResult.value;
          playerMarkerGrayscaleTextureRef.current = createGrayscaleTexture(
            textureResult.value,
          );
          playerMarkerModelTemplateRef.current = modelResult.value;
          playerAssetsLoadedRef.current = true;
          playerAssetsRetryAttemptRef.current = 0;
          playerAssetsLoadingRef.current = false;
          if (playerAssetsRetryTimerRef.current) {
            window.clearTimeout(playerAssetsRetryTimerRef.current);
            playerAssetsRetryTimerRef.current = null;
          }
          onUpdatePlayerMarkers();
          return;
        }

        if (textureResult.status === "fulfilled") {
          textureResult.value.dispose();
        }
        if (modelResult.status === "fulfilled") {
          disposePlayerMarkerTemplate(modelResult.value);
        }

        playerAssetsLoadedRef.current = false;
        playerAssetsLoadingRef.current = false;
        if (playerAssetsRetryAttemptRef.current === 0) {
          playerAssetsRetryAttemptRef.current = 1;
          playerAssetsRetryTimerRef.current = window.setTimeout(() => {
            playerAssetsRetryTimerRef.current = null;
            void loadPlayerAssets();
          }, 1000);
        }
        onUpdatePlayerMarkers();
      } catch {
        if (cancelled || loadId !== playerAssetsLoadIdRef.current) {
          return;
        }

        playerAssetsLoadedRef.current = false;
        playerAssetsLoadingRef.current = false;
        if (playerAssetsRetryAttemptRef.current === 0) {
          playerAssetsRetryAttemptRef.current = 1;
          playerAssetsRetryTimerRef.current = window.setTimeout(() => {
            playerAssetsRetryTimerRef.current = null;
            void loadPlayerAssets();
          }, 1000);
        }
        onUpdatePlayerMarkers();
      }
    }

    void loadPlayerAssets();

    return () => {
      cancelled = true;
      playerAssetsLoadIdRef.current += 1;
      playerAssetsLoadingRef.current = false;
      playerAssetsRetryAttemptRef.current = 0;
      if (playerAssetsRetryTimerRef.current) {
        window.clearTimeout(playerAssetsRetryTimerRef.current);
        playerAssetsRetryTimerRef.current = null;
      }
    };
  }, [showPlayers, players.length]);

  useEffect(
    () => () => {
      playerAssetsLoadIdRef.current += 1;
      playerAssetsLoadingRef.current = false;
      playerAssetsLoadedRef.current = false;
      playerAssetsRetryAttemptRef.current = 0;
      if (playerAssetsRetryTimerRef.current) {
        window.clearTimeout(playerAssetsRetryTimerRef.current);
        playerAssetsRetryTimerRef.current = null;
      }
      if (playerMarkerTextureRef.current) {
        playerMarkerTextureRef.current.dispose();
        playerMarkerTextureRef.current = null;
      }
      if (playerMarkerGrayscaleTextureRef.current) {
        playerMarkerGrayscaleTextureRef.current.dispose();
        playerMarkerGrayscaleTextureRef.current = null;
      }
      if (playerMarkerModelTemplateRef.current) {
        disposePlayerMarkerTemplate(playerMarkerModelTemplateRef.current);
        playerMarkerModelTemplateRef.current = null;
      }
    },
    [],
  );

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
      mode: modeRef.current,
      showTerrain: showTerrainRef.current,
      showVoxelTerrain: showVoxelTerrainRef.current,
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
    });
  }

  function updateVoxelLod(
    focusLod: number,
    cameraPosition: THREE.Vector3,
    cameraForward: THREE.Vector3,
  ) {
    updateVoxelLodManaged({
      focusLod,
      cameraPosition,
      cameraForward,
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
        voxelAoIntensity: debugSettingsRef.current.voxelAoIntensity,
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
      mode: modeRef.current,
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

  function refreshDebugLabels() {
    refreshDebugLabelsManaged({
      group: debugLabelGroupRef.current,
      labelMap: debugLabelMapRef.current,
      debugEnabled: debugEnabledRef.current,
      showTiles: showChunkBordersRef.current,
      showHeights:
        showVoxelHeightLabelsRef.current && modeRef.current === "voxel",
      mode: modeRef.current,
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

  function updatePlayerMarkers() {
    const playerMarkerModelTemplate = playerMarkerModelTemplateRef.current;
    const playerMarkerTexture = playerMarkerTextureRef.current;
    const playerMarkerGrayscaleTexture =
      playerMarkerGrayscaleTextureRef.current;
    syncPlayerMarkers({
      players: playersRef.current,
      markerGroup: markerGroupRef.current,
      hasPlayerMarkerModel: Boolean(
        playerMarkerModelTemplate &&
          playerMarkerTexture &&
          playerMarkerGrayscaleTexture,
      ),
      createPlayerMarkerModel:
        playerMarkerModelTemplate &&
        playerMarkerTexture &&
        playerMarkerGrayscaleTexture
          ? (player) =>
              createPlayerMarkerModel(
                playerMarkerModelTemplate,
                player.isActive
                  ? playerMarkerTexture
                  : playerMarkerGrayscaleTexture,
                player.position[2] < 0,
              )
          : () => null,
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
      mode: modeRef.current,
      showTerrain: showTerrainRef.current,
      showVoxelTerrain: showVoxelTerrainRef.current,
      loadedTerrain: loadedTerrainRef.current,
      evictWarmCachedTerrainTile,
      queueTerrainTileLoad,
      disposeTerrainTile: (tile) => disposeTerrainTile(tile, false),
      debugLabelsDirtyRef,
      biomeLabelsDirtyRef,
    });
  }

  function handleRegionUpdate(lod: number, regionX: number, regionY: number) {
    handleVoxelRegionUpdate({
      lod,
      regionX,
      regionY,
      mode: modeRef.current,
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
    });
  }

  function checkAndUpdateLOD(
    camera: THREE.PerspectiveCamera,
    controls: OrbitControls,
  ) {
    checkAndUpdateLodManaged({
      camera,
      controls,
      mode: modeRef.current,
      showTerrain: showTerrainRef.current,
      showVoxelTerrain: showVoxelTerrainRef.current,
      voxelLastCameraSampleRef,
      voxelLastMotionAtRef,
      pendingVoxelDetailRequestsRef,
      committedVoxelDetailRequestsRef,
      syncVoxelRequests,
      activeFocusLodRef,
      syncTerrainLod,
      updateTerrainVisibility,
      terrainVisibilityDirtyRef,
      resolveVoxelLodFocus: (activeCamera, activeControls, cameraForward) =>
        resolveVoxelLodFocus({
          camera: activeCamera,
          controls: activeControls,
          voxelGroup: voxelGroupRef.current,
          loadedVoxels: loadedVoxelsRef.current,
          cameraForward,
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
      mode: modeRef.current,
      renderer,
      preUploadTarget,
      preUploadScene,
      preUploadCamera,
      voxelMaterial,
      markVoxelTileFresh,
      failedVoxels: failedVoxelsRef.current,
      missingVoxels: missingVoxelsRef.current,
      debugLabelsDirtyRef,
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
      mode: modeRef.current,
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
    modeRef,
    showTerrainRef,
    showVoxelTerrainRef,
    showChunkBordersRef,
    showBiomeLabelsRef,
    debugEnabledRef,
    debugSettingsRef,
    keysHeldRef,
    terrainLoadGenerationRef,
    worldDataRef,
    loadedVoxelsRef,
    onCursorMoveRef,
    onPlayerClickRef,
    terrainVisibilityDirtyRef,
    debugLabelsDirtyRef,
    biomeLabelsDirtyRef,
    updateMarkerScales,
    handleWorkerMessage,
    buildQueuedTerrainMeshes: buildQueuedTerrainMeshesForFrame,
    buildQueuedVoxelMeshes: buildQueuedVoxelMeshesForFrame,
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
    addSpawnMarker,
    updatePlayerMarkers,
    checkAndUpdateLOD,
  });

  useWorld3DChunkStatsReset({
    modeRef,
    onChunkStatsChangeRef,
  });

  useWorld3DSceneSyncEffects({
    surfaceIndex: worldData.surfaceIndex,
    chunkIndex: worldData.chunkIndex,
    mode,
    showTerrain,
    showVoxelTerrain,
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
  });

  useWorld3DUpdateSubscription({
    subscribe,
    handleTileUpdate,
    handleRegionUpdate,
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
