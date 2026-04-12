import type * as THREE from "three";
import type {
  LoadedVoxelTile,
  PendingVoxelFetchRequest,
  PendingVoxelMeshItem,
  VoxelRefreshState,
  WarmCachedVoxelTile,
  WorkerOut,
} from "./types.js";
import {
  buildVoxelBorderLines,
  buildVoxelQuadrantSubMeshes,
} from "./voxel-builders.js";
import { voxelTileKey } from "./voxel-index.js";
import { runVoxelLodSelection } from "./voxel-lod.js";
import { compareVoxelFetchRequests } from "./voxel-requests.js";

export function clearVoxelTiles(args: {
  preserveWarmCache?: boolean;
  loadedVoxels: Map<string, LoadedVoxelTile>;
  voxelFetchControllers: Map<string, AbortController>;
  loadingVoxels: Set<string>;
  missingVoxels: Set<string>;
  failedVoxels: Map<string, number>;
  activeVoxelRequestKeys: Set<string>;
  voxelRefreshStates: Map<string, VoxelRefreshState>;
  pendingVoxelDetailRequests: Map<string, PendingVoxelFetchRequest>;
  committedVoxelDetailRequests: Map<string, PendingVoxelFetchRequest>;
  voxelUnloadGraceUntil: Map<string, number>;
  voxelLastCameraSampleRef: {
    current: { camera: THREE.Vector3; target: THREE.Vector3 } | null;
  };
  voxelLastMotionAtRef: { current: number };
  pendingVoxelFetchQueueRef: { current: PendingVoxelFetchRequest[] };
  pendingVoxelMeshQueueRef: { current: PendingVoxelMeshItem[] };
  activeVoxelFetchCountRef: { current: number };
  warmCachedVoxels: Map<string, WarmCachedVoxelTile>;
  warmCachedVoxelBytesRef: { current: number };
  unloadVoxelTile: (key: string, preserveWarmCache?: boolean) => void;
  evictWarmCachedVoxelTile: (key: string) => void;
}): void {
  const {
    preserveWarmCache = false,
    loadedVoxels,
    voxelFetchControllers,
    loadingVoxels,
    missingVoxels,
    failedVoxels,
    activeVoxelRequestKeys,
    voxelRefreshStates,
    pendingVoxelDetailRequests,
    committedVoxelDetailRequests,
    voxelUnloadGraceUntil,
    voxelLastCameraSampleRef,
    voxelLastMotionAtRef,
    pendingVoxelFetchQueueRef,
    pendingVoxelMeshQueueRef,
    activeVoxelFetchCountRef,
    warmCachedVoxels,
    warmCachedVoxelBytesRef,
    unloadVoxelTile,
    evictWarmCachedVoxelTile,
  } = args;

  for (const key of loadedVoxels.keys()) {
    unloadVoxelTile(key, preserveWarmCache);
  }
  for (const controller of voxelFetchControllers.values()) {
    controller.abort();
  }
  voxelFetchControllers.clear();
  loadedVoxels.clear();
  loadingVoxels.clear();
  missingVoxels.clear();
  failedVoxels.clear();
  activeVoxelRequestKeys.clear();
  voxelRefreshStates.clear();
  pendingVoxelDetailRequests.clear();
  committedVoxelDetailRequests.clear();
  voxelUnloadGraceUntil.clear();
  voxelLastCameraSampleRef.current = null;
  voxelLastMotionAtRef.current = 0;
  pendingVoxelFetchQueueRef.current = [];
  pendingVoxelMeshQueueRef.current = [];
  activeVoxelFetchCountRef.current = 0;

  if (!preserveWarmCache) {
    for (const key of [...warmCachedVoxels.keys()]) {
      evictWarmCachedVoxelTile(key);
    }
    warmCachedVoxels.clear();
    warmCachedVoxelBytesRef.current = 0;
  }
}

export function requestDirectVoxelRefresh(args: {
  lod: number;
  regionX: number;
  regionY: number;
  version: number;
  worker: Worker | null;
  failedVoxels: Map<string, number>;
  maxVoxelRetries: number;
  voxelFetchControllers: Map<string, AbortController>;
  activeVoxelFetchCountRef: { current: number };
  loadingVoxels: Set<string>;
  fetchVoxelRegion: (
    request: PendingVoxelFetchRequest,
    controller: AbortController,
  ) => void;
  activeVoxelRequestGeneration: number;
}): void {
  const {
    lod,
    regionX,
    regionY,
    version,
    worker,
    failedVoxels,
    maxVoxelRetries,
    voxelFetchControllers,
    activeVoxelFetchCountRef,
    loadingVoxels,
    fetchVoxelRegion,
    activeVoxelRequestGeneration,
  } = args;
  const key = voxelTileKey(lod, regionX, regionY);
  if (!worker) return;

  const retries = failedVoxels.get(key);
  if (retries !== undefined && retries >= maxVoxelRetries) return;

  voxelFetchControllers.get(key)?.abort();
  if (voxelFetchControllers.has(key)) return;

  activeVoxelFetchCountRef.current++;
  loadingVoxels.add(key);
  const controller = new AbortController();
  voxelFetchControllers.set(key, controller);

  void fetchVoxelRegion(
    {
      key,
      lod,
      regionX,
      regionY,
      priority: Number.NEGATIVE_INFINITY,
      generation: activeVoxelRequestGeneration,
      version,
    },
    controller,
  );
}

export function requestVoxelRegion(args: {
  request: PendingVoxelFetchRequest;
  loadedVoxels: Map<string, LoadedVoxelTile>;
  isVoxelTileStale: (key: string) => boolean;
  restoreVoxelTileFromWarmCache: (key: string) => LoadedVoxelTile | null;
  voxelUnloadGraceUntil: Map<string, number>;
  voxelUnloadGraceMs: number;
  markVoxelTileFresh: (key: string, version: number) => void;
  debugLabelsDirtyRef: { current: boolean };
  missingVoxels: Set<string>;
  failedVoxels: Map<string, number>;
  maxVoxelRetries: number;
  worker: Worker | null;
  voxelFetchControllers: Map<string, AbortController>;
  loadingVoxels: Set<string>;
  queueVoxelFetchRequest: (request: PendingVoxelFetchRequest) => void;
}): void {
  const {
    request,
    loadedVoxels,
    isVoxelTileStale,
    restoreVoxelTileFromWarmCache,
    voxelUnloadGraceUntil,
    voxelUnloadGraceMs,
    markVoxelTileFresh,
    debugLabelsDirtyRef,
    missingVoxels,
    failedVoxels,
    maxVoxelRetries,
    worker,
    voxelFetchControllers,
    loadingVoxels,
    queueVoxelFetchRequest,
  } = args;
  const { key } = request;
  if (loadedVoxels.has(key) && !isVoxelTileStale(key)) return;

  const restored = restoreVoxelTileFromWarmCache(key);
  if (restored) {
    loadedVoxels.set(key, restored);
    voxelUnloadGraceUntil.set(key, performance.now() + voxelUnloadGraceMs);
    markVoxelTileFresh(key, request.version);
    debugLabelsDirtyRef.current = true;
    return;
  }

  if (missingVoxels.has(key)) return;

  const retries = failedVoxels.get(key);
  if (retries !== undefined && retries >= maxVoxelRetries) return;
  if (!worker) return;

  if (voxelFetchControllers.has(key)) return;

  if (loadingVoxels.has(key)) {
    return;
  }

  loadingVoxels.add(key);
  queueVoxelFetchRequest(request);
}

export function drainVoxelFetchQueue(args: {
  pendingVoxelFetchQueueRef: { current: PendingVoxelFetchRequest[] };
  activeVoxelFetchCountRef: { current: number };
  maxConcurrentVoxelFetches: number;
  activeVoxelRequestKeys: Set<string>;
  loadedVoxels: Map<string, LoadedVoxelTile>;
  isVoxelTileStale: (key: string) => boolean;
  missingVoxels: Set<string>;
  failedVoxels: Map<string, number>;
  maxVoxelRetries: number;
  voxelFetchControllers: Map<string, AbortController>;
  loadingVoxels: Set<string>;
  fetchVoxelRegion: (
    request: PendingVoxelFetchRequest,
    controller: AbortController,
  ) => void;
}): void {
  const {
    pendingVoxelFetchQueueRef,
    activeVoxelFetchCountRef,
    maxConcurrentVoxelFetches,
    activeVoxelRequestKeys,
    loadedVoxels,
    isVoxelTileStale,
    missingVoxels,
    failedVoxels,
    maxVoxelRetries,
    voxelFetchControllers,
    loadingVoxels,
    fetchVoxelRegion,
  } = args;
  pendingVoxelFetchQueueRef.current.sort(compareVoxelFetchRequests);

  while (
    activeVoxelFetchCountRef.current < maxConcurrentVoxelFetches &&
    pendingVoxelFetchQueueRef.current.length > 0
  ) {
    const next = pendingVoxelFetchQueueRef.current.shift();
    if (!next) continue;
    if (!activeVoxelRequestKeys.has(next.key)) {
      loadingVoxels.delete(next.key);
      continue;
    }
    if (
      (loadedVoxels.has(next.key) && !isVoxelTileStale(next.key)) ||
      missingVoxels.has(next.key)
    ) {
      loadingVoxels.delete(next.key);
      continue;
    }

    const retries = failedVoxels.get(next.key);
    if (retries !== undefined && retries >= maxVoxelRetries) {
      loadingVoxels.delete(next.key);
      continue;
    }
    if (voxelFetchControllers.has(next.key)) {
      continue;
    }
    if (!loadingVoxels.has(next.key)) {
      continue;
    }

    activeVoxelFetchCountRef.current++;
    const controller = new AbortController();
    voxelFetchControllers.set(next.key, controller);
    void fetchVoxelRegion(next, controller);
  }
}

export function updateVoxelLod(args: {
  target: THREE.Vector3;
  camDist: number;
  focusLod: number;
  cameraPosition: THREE.Vector3;
  cameraForward: THREE.Vector3;
  voxelRootEntries: { lod: number; regionX: number; regionY: number }[];
  availableVoxelKeys: Set<string>;
  loadedVoxels: Map<string, LoadedVoxelTile>;
  loadingVoxels: Set<string>;
  pendingVoxelMeshQueue: PendingVoxelMeshItem[];
  voxelUnloadGraceUntil: Map<string, number>;
  voxelThresholds: { maxDist: number; lod: number }[];
  renderDistance: number;
  minRenderedVoxelLod: number;
  activeVoxelRequestGenerationRef: { current: number };
  voxelLastMotionAt: number;
  voxelDetailRequestDebounceMs: number;
  debugSettings: {
    voxelBehindCameraDotStart: number;
    voxelBehindCameraMaxMultiplier: number;
    lodUnloadHysteresis: number;
    voxelLodHysteresisRatio: number;
    voxelUnloadGraceMs: number;
  };
  pendingVoxelDetailRequestsRef: {
    current: Map<string, PendingVoxelFetchRequest>;
  };
  committedVoxelDetailRequestsRef: {
    current: Map<string, PendingVoxelFetchRequest>;
  };
  getVoxelRefreshVersion: (key: string) => number;
  isVoxelTileStale: (key: string) => boolean;
  unloadVoxelTile: (key: string, preserveWarmCache?: boolean) => void;
  syncVoxelRequests: (requests: Map<string, PendingVoxelFetchRequest>) => void;
  debugLabelsDirtyRef: { current: boolean };
}): void {
  const {
    target,
    camDist,
    focusLod,
    cameraPosition,
    cameraForward,
    voxelRootEntries,
    availableVoxelKeys,
    loadedVoxels,
    loadingVoxels,
    pendingVoxelMeshQueue,
    voxelUnloadGraceUntil,
    voxelThresholds,
    renderDistance,
    minRenderedVoxelLod,
    activeVoxelRequestGenerationRef,
    voxelLastMotionAt,
    voxelDetailRequestDebounceMs,
    debugSettings,
    pendingVoxelDetailRequestsRef,
    committedVoxelDetailRequestsRef,
    getVoxelRefreshVersion,
    isVoxelTileStale,
    unloadVoxelTile,
    syncVoxelRequests,
    debugLabelsDirtyRef,
  } = args;

  if (voxelRootEntries.length === 0) {
    pendingVoxelDetailRequestsRef.current.clear();
    committedVoxelDetailRequestsRef.current.clear();
    syncVoxelRequests(new Map());
    return;
  }

  const now = performance.now();
  const requestGeneration = activeVoxelRequestGenerationRef.current + 1;
  activeVoxelRequestGenerationRef.current = requestGeneration;
  const stableForDetail =
    now - voxelLastMotionAt >= voxelDetailRequestDebounceMs;

  const result = runVoxelLodSelection({
    target,
    camDist,
    focusLod,
    cameraPosition,
    cameraForward,
    roots: voxelRootEntries,
    availableVoxelKeys,
    loadedVoxels,
    loadingVoxels,
    pendingVoxelMeshQueue,
    voxelUnloadGraceUntil,
    voxelThresholds,
    renderDistance,
    minRenderedVoxelLod,
    requestGeneration,
    now,
    stableForDetail,
    debugSettings,
    getVoxelRefreshVersion,
    isVoxelTileStale,
    unloadVoxelTile,
  });

  pendingVoxelDetailRequestsRef.current = result.detailVoxelRequests;
  committedVoxelDetailRequestsRef.current = result.committedVoxelDetailRequests;
  syncVoxelRequests(result.requestedVoxelRequests);

  if (result.debugLabelsDirty) {
    debugLabelsDirtyRef.current = true;
  }
}

export function handleVoxelWorkerMessage(args: {
  data: WorkerOut;
  getVoxelRefreshVersion: (key: string) => number;
  activeVoxelRequestKeys: Set<string>;
  loadedVoxels: Map<string, LoadedVoxelTile>;
  loadingVoxels: Set<string>;
  failedVoxels: Map<string, number>;
  pendingVoxelMeshQueueRef: { current: PendingVoxelMeshItem[] };
  isVoxelTileStale: (key: string) => boolean;
  onBenchmarkSample?: (sample: NonNullable<WorkerOut["benchmark"]>) => void;
}): void {
  const {
    data,
    getVoxelRefreshVersion,
    activeVoxelRequestKeys,
    loadedVoxels,
    loadingVoxels,
    failedVoxels,
    pendingVoxelMeshQueueRef,
    isVoxelTileStale,
    onBenchmarkSample,
  } = args;
  const {
    lod,
    regionX,
    regionY,
    version,
    quadrantMeshes,
    chunkCoverage,
    chunkTopHeights,
    voxelSize,
    minZ,
    maxZ,
    benchmark,
    error,
  } = data;

  if (benchmark) {
    onBenchmarkSample?.({
      ...benchmark,
      totalMs: benchmark.fetchMs + benchmark.decodeMs,
    });
  }

  const resolvedLod = lod ?? 1;
  const key = voxelTileKey(resolvedLod, regionX, regionY);
  const resolvedVersion = version ?? 0;
  if (error || !quadrantMeshes) {
    if (resolvedVersion < getVoxelRefreshVersion(key)) {
      loadingVoxels.delete(key);
      return;
    }
    if (!activeVoxelRequestKeys.has(key)) {
      loadingVoxels.delete(key);
      return;
    }
    loadingVoxels.delete(key);
    failedVoxels.set(key, (failedVoxels.get(key) ?? 0) + 1);
    return;
  }

  if (
    !activeVoxelRequestKeys.has(key) &&
    !(loadedVoxels.has(key) && isVoxelTileStale(key))
  ) {
    loadingVoxels.delete(key);
    return;
  }

  if (resolvedVersion < getVoxelRefreshVersion(key)) {
    loadingVoxels.delete(key);
    return;
  }

  pendingVoxelMeshQueueRef.current = pendingVoxelMeshQueueRef.current.filter(
    (item) => item.key !== key || item.version >= resolvedVersion,
  );

  const topHeights =
    chunkTopHeights && chunkTopHeights.length === 16
      ? chunkTopHeights
      : new Float32Array(16).fill(Number.NEGATIVE_INFINITY);

  const resolvedMinZ =
    typeof minZ === "number" && Number.isFinite(minZ) ? minZ : 0;
  const resolvedMaxZ =
    typeof maxZ === "number" && Number.isFinite(maxZ) ? maxZ : 0;

  pendingVoxelMeshQueueRef.current.push({
    key,
    lod: resolvedLod,
    regionX,
    regionY,
    quadrantMeshes,
    chunkCoverage: chunkCoverage ?? 0,
    chunkTopHeights: topHeights,
    voxelSize: voxelSize ?? resolvedLod,
    minZ: resolvedMinZ,
    maxZ: resolvedMaxZ,
    version: resolvedVersion,
  });
}

export function buildQueuedVoxelMeshes(args: {
  pendingVoxelMeshQueueRef: { current: PendingVoxelMeshItem[] };
  maxVoxelMeshesPerFrame: number;
  voxelMeshBuildBudgetMs: number;
  getVoxelRefreshVersion: (key: string) => number;
  activeVoxelRequestKeys: Set<string>;
  loadedVoxels: Map<string, LoadedVoxelTile>;
  loadingVoxels: Set<string>;
  isVoxelTileStale: (key: string) => boolean;
  voxelGroup: THREE.Group | null;
  chunkBorderGroup: THREE.Group | null;
  mode: "terrain" | "voxel";
  renderer: THREE.WebGLRenderer;
  preUploadTarget: THREE.WebGLRenderTarget;
  preUploadScene: THREE.Scene;
  preUploadCamera: THREE.Camera;
  voxelMaterial: THREE.Material;
  markVoxelTileFresh: (key: string, version: number) => void;
  failedVoxels: Map<string, number>;
  missingVoxels: Set<string>;
  debugLabelsDirtyRef: { current: boolean };
  disposeVoxelTileResources: (tile: LoadedVoxelTile) => void;
}): boolean {
  const {
    pendingVoxelMeshQueueRef,
    maxVoxelMeshesPerFrame,
    voxelMeshBuildBudgetMs,
    getVoxelRefreshVersion,
    activeVoxelRequestKeys,
    loadedVoxels,
    loadingVoxels,
    isVoxelTileStale,
    voxelGroup,
    chunkBorderGroup,
    mode,
    renderer,
    preUploadTarget,
    preUploadScene,
    preUploadCamera,
    voxelMaterial,
    markVoxelTileFresh,
    failedVoxels,
    missingVoxels,
    debugLabelsDirtyRef,
    disposeVoxelTileResources,
  } = args;

  let builtVoxelTile = false;
  if (pendingVoxelMeshQueueRef.current.length === 0) return builtVoxelTile;

  const voxelMeshBuildStart = performance.now();
  let processedVoxelMeshes = 0;
  while (
    pendingVoxelMeshQueueRef.current.length > 0 &&
    processedVoxelMeshes < maxVoxelMeshesPerFrame &&
    performance.now() - voxelMeshBuildStart < voxelMeshBuildBudgetMs
  ) {
    const item = pendingVoxelMeshQueueRef.current.shift();
    if (!item) continue;
    processedVoxelMeshes++;
    if (item.version < getVoxelRefreshVersion(item.key)) {
      loadingVoxels.delete(item.key);
      continue;
    }
    if (
      !activeVoxelRequestKeys.has(item.key) &&
      !(loadedVoxels.has(item.key) && isVoxelTileStale(item.key))
    ) {
      loadingVoxels.delete(item.key);
      continue;
    }

    const existingTile = loadedVoxels.get(item.key);
    const canReplaceExisting = existingTile
      ? isVoxelTileStale(item.key)
      : false;
    loadingVoxels.delete(item.key);
    if (
      (!existingTile || canReplaceExisting) &&
      voxelGroup &&
      mode === "voxel"
    ) {
      const built = buildVoxelQuadrantSubMeshes(item, voxelMaterial);
      if (built.subMeshes.length > 0) {
        for (const sm of built.subMeshes) {
          preUploadScene.add(sm.mesh);
        }
        renderer.setRenderTarget(preUploadTarget);
        renderer.render(preUploadScene, preUploadCamera);
        renderer.setRenderTarget(null);
        for (const sm of built.subMeshes) {
          preUploadScene.remove(sm.mesh);
        }

        const borderLines = buildVoxelBorderLines(
          item.regionX,
          item.regionY,
          item.lod,
          built.minZ,
          built.maxZ,
        );
        borderLines.visible = false;

        for (const sm of built.subMeshes) {
          sm.mesh.visible = false;
          voxelGroup.add(sm.mesh);
        }
        chunkBorderGroup?.add(borderLines);
        const nextTile: LoadedVoxelTile = {
          key: item.key,
          lod: item.lod,
          regionX: item.regionX,
          regionY: item.regionY,
          voxelSize: item.voxelSize,
          subMeshes: built.subMeshes,
          minZ: built.minZ,
          maxZ: built.maxZ,
          chunkCoverage: item.chunkCoverage,
          chunkTopHeights: item.chunkTopHeights,
          borderLines,
        };
        loadedVoxels.set(item.key, nextTile);
        if (existingTile && canReplaceExisting) {
          disposeVoxelTileResources(existingTile);
        }
        markVoxelTileFresh(item.key, item.version);
        failedVoxels.delete(item.key);
        debugLabelsDirtyRef.current = true;
        builtVoxelTile = true;
      } else {
        missingVoxels.add(item.key);
        markVoxelTileFresh(item.key, item.version);
      }
    }
  }

  return builtVoxelTile;
}
