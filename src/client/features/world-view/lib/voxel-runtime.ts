import type * as THREE from "three";
import type { ChunkIndexEntry } from "../hooks/useWorldData.js";
import type {
  LoadedVoxelTile,
  PendingVoxelFetchRequest,
  PendingVoxelMeshItem,
  VoxelRefreshState,
  WarmCachedVoxelTile,
  WorkerMeshResult,
  WorkerOut,
} from "./types.js";
import {
  buildVoxelBorderLines,
  buildVoxelQuadrantSubMeshes,
} from "./voxel-builders.js";
import { voxelTileKey } from "./voxel-index.js";
import { runVoxelLodSelection } from "./voxel-lod.js";
import { compareVoxelFetchRequests } from "./voxel-requests.js";
import type { VoxelViewClass, VoxelWorkPriority } from "./voxel-work.js";

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
  failedVoxels: Map<string, number>;
  maxVoxelRetries: number;
  loadingVoxels: Set<string>;
  queueVoxelFetchRequest: (request: PendingVoxelFetchRequest) => void;
  drainVoxelFetchQueue: () => void;
  activeVoxelRequestGeneration: number;
  priority?: VoxelWorkPriority;
}): void {
  const {
    lod,
    regionX,
    regionY,
    version,
    failedVoxels,
    maxVoxelRetries,
    loadingVoxels,
    queueVoxelFetchRequest,
    drainVoxelFetchQueue,
    activeVoxelRequestGeneration,
    priority,
  } = args;
  const key = voxelTileKey(lod, regionX, regionY);
  const retries = failedVoxels.get(key);
  if (retries !== undefined && retries >= maxVoxelRetries) return;

  loadingVoxels.add(key);
  queueVoxelFetchRequest({
    key,
    lod,
    regionX,
    regionY,
    priority:
      priority ??
      ({
        coverageClass: "detail",
        viewClass: "forward",
        projectedBenefit: Number.MAX_VALUE,
        distance: 0,
        lod,
        generation: activeVoxelRequestGeneration,
      } satisfies VoxelWorkPriority),
    generation: activeVoxelRequestGeneration,
    version,
    selectedAt: performance.now(),
  });
  drainVoxelFetchQueue();
}

export function requestVoxelRegion(args: {
  request: PendingVoxelFetchRequest;
  loadedVoxels: Map<string, LoadedVoxelTile>;
  isVoxelTileStale: (key: string) => boolean;
  restoreVoxelTileFromWarmCache: (key: string) => LoadedVoxelTile | null;
  onVoxelTileRestored?: () => void;
  voxelUnloadGraceUntil: Map<string, number>;
  voxelUnloadGraceMs: number;
  markVoxelTileFresh: (key: string, version: number) => void;
  debugLabelsDirtyRef: { current: boolean };
  biomeLabelsDirtyRef: { current: boolean };
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
    onVoxelTileRestored,
    voxelUnloadGraceUntil,
    voxelUnloadGraceMs,
    markVoxelTileFresh,
    debugLabelsDirtyRef,
    biomeLabelsDirtyRef,
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
    onVoxelTileRestored?.();
    voxelUnloadGraceUntil.set(key, performance.now() + voxelUnloadGraceMs);
    markVoxelTileFresh(key, request.version);
    debugLabelsDirtyRef.current = true;
    biomeLabelsDirtyRef.current = true;
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
  canStartFetch?: () => boolean;
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
    canStartFetch = () => true,
  } = args;
  pendingVoxelFetchQueueRef.current.sort(compareVoxelFetchRequests);

  while (
    activeVoxelFetchCountRef.current < maxConcurrentVoxelFetches &&
    canStartFetch() &&
    pendingVoxelFetchQueueRef.current.length > 0
  ) {
    const nextIndex = pendingVoxelFetchQueueRef.current.findIndex(
      (request) => !voxelFetchControllers.has(request.key),
    );
    if (nextIndex < 0) break;
    const [next] = pendingVoxelFetchQueueRef.current.splice(nextIndex, 1);
    if (!next) continue;
    if (
      !activeVoxelRequestKeys.has(next.key) &&
      !(loadedVoxels.has(next.key) && isVoxelTileStale(next.key))
    ) {
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
  focusLod: number;
  cameraPosition: THREE.Vector3;
  referenceSurfaceZ: number;
  cameraForward: THREE.Vector3;
  screenSpaceDistanceScale: number;
  cameraFov: number;
  viewportHeight: number;
  viewportAspect: number;
  focusPoint: THREE.Vector3 | null;
  voxelRootEntries: ChunkIndexEntry[];
  availableVoxelKeys: Set<string>;
  loadedVoxels: Map<string, LoadedVoxelTile>;
  warmCachedVoxels: Map<string, WarmCachedVoxelTile>;
  loadingVoxels: Set<string>;
  pendingVoxelMeshQueue: PendingVoxelMeshItem[];
  voxelUnloadGraceUntil: Map<string, number>;
  voxelThresholds: { maxDist: number; lod: number }[];
  renderDistance: number;
  minRenderedVoxelLod: number;
  activeVoxelRequestGenerationRef: { current: number };
  voxelViewClasses: Map<string, VoxelViewClass>;
  voxelLastMotionAt: number;
  voxelDetailRequestDebounceMs: number;
  debugSettings: {
    voxelBehindCameraDotStart: number;
    voxelBehindCameraMaxMultiplier: number;
    lodUnloadHysteresis: number;
    voxelLodHysteresisRatio: number;
    voxelTopAoIntensity: number;
    voxelWallAoIntensity: number;
    voxelUnloadGraceMs: number;
    voxelViewEnterMarginDegrees: number;
    voxelViewExitMarginDegrees: number;
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
  onVoxelVisible?: (key: string, visibleAt: number) => void;
}): void {
  const {
    focusLod,
    cameraPosition,
    referenceSurfaceZ,
    cameraForward,
    screenSpaceDistanceScale,
    cameraFov,
    viewportHeight,
    viewportAspect,
    focusPoint,
    voxelRootEntries,
    availableVoxelKeys,
    loadedVoxels,
    warmCachedVoxels,
    loadingVoxels,
    pendingVoxelMeshQueue,
    voxelUnloadGraceUntil,
    voxelThresholds,
    renderDistance,
    minRenderedVoxelLod,
    activeVoxelRequestGenerationRef,
    voxelViewClasses,
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
    onVoxelVisible,
  } = args;

  if (voxelRootEntries.length === 0) {
    voxelViewClasses.clear();
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
    focusLod,
    cameraPosition,
    referenceSurfaceZ,
    cameraForward,
    screenSpaceDistanceScale,
    cameraFov,
    viewportHeight,
    viewportAspect,
    focusPoint,
    roots: voxelRootEntries,
    availableVoxelKeys,
    loadedVoxels,
    warmCachedVoxels,
    loadingVoxels,
    pendingVoxelMeshQueue,
    voxelUnloadGraceUntil,
    voxelThresholds,
    renderDistance,
    minRenderedVoxelLod,
    requestGeneration,
    voxelViewClasses,
    now,
    stableForDetail,
    debugSettings,
    getVoxelRefreshVersion,
    isVoxelTileStale,
    unloadVoxelTile,
  });

  for (const [key, tile] of loadedVoxels) {
    if (
      tile.subMeshes.some((subMesh) => subMesh.mesh.visible) ||
      tile.transparentSubMeshes.some((subMesh) => subMesh.mesh.visible)
    ) {
      onVoxelVisible?.(key, now);
    }
  }

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
  onBenchmarkSample?: (
    sample: NonNullable<WorkerMeshResult["benchmark"]>,
  ) => void;
  acceptMeshResult?: (item: PendingVoxelMeshItem, bytes: number) => boolean;
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
    acceptMeshResult = () => true,
  } = args;
  const { lod, regionX, regionY, version } = data;

  const resolvedLod = lod;
  const key = voxelTileKey(resolvedLod, regionX, regionY);
  const resolvedVersion = version;
  if (data.type === "cancelled") {
    loadingVoxels.delete(key);
    return;
  }

  const { benchmark } = data;

  if (benchmark) {
    onBenchmarkSample?.({
      ...benchmark,
      totalMs: benchmark.fetchMs + benchmark.decodeMs,
    });
  }

  if (data.type === "error") {
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

  const {
    quadrantMeshes,
    transparentQuadrantMeshes,
    chunkCoverage,
    chunkTopHeights,
    voxelSize,
    minZ,
    maxZ,
    emitterRecords,
  } = data;

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

  const item: PendingVoxelMeshItem = {
    jobId: data.jobId,
    key,
    lod: resolvedLod,
    regionX,
    regionY,
    quadrantMeshes,
    transparentQuadrantMeshes,
    chunkCoverage,
    chunkTopHeights: topHeights,
    voxelSize,
    minZ: resolvedMinZ,
    maxZ: resolvedMaxZ,
    emitterRecords,
    haloEmitterSourceKeys: [],
    version: resolvedVersion,
  };
  if (acceptMeshResult(item, getVoxelMeshOutputBytes(data))) {
    pendingVoxelMeshQueueRef.current.push(item);
  }
}

function getVoxelMeshOutputBytes(result: WorkerMeshResult): number {
  if (result.benchmark) return result.benchmark.workerOutputBytes;
  let bytes = result.chunkTopHeights.byteLength;
  for (const quadrant of [
    ...result.quadrantMeshes,
    ...result.transparentQuadrantMeshes,
  ]) {
    bytes +=
      quadrant.positions.byteLength +
      quadrant.normals.byteLength +
      quadrant.baseColors.byteLength +
      quadrant.faceAo.byteLength +
      quadrant.trianglePaletteIndices.byteLength +
      quadrant.indices.byteLength +
      (quadrant.emissiveColors?.byteLength ?? 0);
  }
  return bytes;
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
  renderer: THREE.WebGLRenderer;
  preUploadTarget: THREE.WebGLRenderTarget;
  preUploadScene: THREE.Scene;
  preUploadCamera: THREE.Camera;
  voxelMaterial: THREE.Material;
  transparentVoxelMaterial: THREE.Material;
  markVoxelTileFresh: (key: string, version: number) => void;
  failedVoxels: Map<string, number>;
  missingVoxels: Set<string>;
  debugLabelsDirtyRef: { current: boolean };
  biomeLabelsDirtyRef: { current: boolean };
  disposeVoxelTileResources: (tile: LoadedVoxelTile) => void;
  onVoxelTileLoaded?: (tile?: LoadedVoxelTile) => void;
  onVoxelMeshFinished?: (
    item: PendingVoxelMeshItem,
    outcome: "loaded" | "discarded" | "error",
  ) => void;
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
    renderer,
    preUploadTarget,
    preUploadScene,
    preUploadCamera,
    voxelMaterial,
    transparentVoxelMaterial,
    markVoxelTileFresh,
    failedVoxels,
    missingVoxels,
    debugLabelsDirtyRef,
    biomeLabelsDirtyRef,
    disposeVoxelTileResources,
    onVoxelTileLoaded,
    onVoxelMeshFinished,
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
      onVoxelMeshFinished?.(item, "discarded");
      continue;
    }
    if (
      !activeVoxelRequestKeys.has(item.key) &&
      !(loadedVoxels.has(item.key) && isVoxelTileStale(item.key))
    ) {
      loadingVoxels.delete(item.key);
      onVoxelMeshFinished?.(item, "discarded");
      continue;
    }

    const existingTile = loadedVoxels.get(item.key);
    const canReplaceExisting = existingTile
      ? isVoxelTileStale(item.key)
      : false;
    loadingVoxels.delete(item.key);
    let outcome: "loaded" | "discarded" | "error" = "discarded";
    try {
      if ((!existingTile || canReplaceExisting) && voxelGroup) {
        const built = buildVoxelQuadrantSubMeshes(
          item,
          voxelMaterial,
          transparentVoxelMaterial,
        );
        if (
          built.subMeshes.length > 0 ||
          built.transparentSubMeshes.length > 0
        ) {
          for (const sm of [
            ...built.subMeshes,
            ...built.transparentSubMeshes,
          ]) {
            preUploadScene.add(sm.mesh);
          }
          renderer.setRenderTarget(preUploadTarget);
          renderer.render(preUploadScene, preUploadCamera);
          renderer.setRenderTarget(null);
          for (const sm of [
            ...built.subMeshes,
            ...built.transparentSubMeshes,
          ]) {
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

          for (const sm of [
            ...built.subMeshes,
            ...built.transparentSubMeshes,
          ]) {
            sm.mesh.visible = false;
            sm.mesh.userData.voxelKey = item.key;
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
            transparentSubMeshes: built.transparentSubMeshes,
            minZ: built.minZ,
            maxZ: built.maxZ,
            chunkCoverage: item.chunkCoverage,
            chunkTopHeights: item.chunkTopHeights,
            emitterRecords: item.emitterRecords,
            haloEmitterSourceKeys: item.haloEmitterSourceKeys,
            borderLines,
          };
          loadedVoxels.set(item.key, nextTile);
          if (existingTile && canReplaceExisting) {
            disposeVoxelTileResources(existingTile);
          }
          markVoxelTileFresh(item.key, item.version);
          failedVoxels.delete(item.key);
          debugLabelsDirtyRef.current = true;
          biomeLabelsDirtyRef.current = true;
          onVoxelTileLoaded?.(nextTile);
          builtVoxelTile = true;
          outcome = "loaded";
        } else {
          if (existingTile && canReplaceExisting) {
            loadedVoxels.delete(item.key);
            disposeVoxelTileResources(existingTile);
            onVoxelTileLoaded?.();
          }
          missingVoxels.add(item.key);
          markVoxelTileFresh(item.key, item.version);
          outcome = "loaded";
        }
      }
    } catch (error) {
      outcome = "error";
      throw error;
    } finally {
      onVoxelMeshFinished?.(item, outcome);
    }
  }

  return builtVoxelTile;
}
