import * as THREE from "three";
import type { ChunkIndexEntry } from "../hooks/useWorldData.js";

import { LOD_LEVELS } from "./constants.js";
import { VOXEL_TOP_AO } from "./daylight.js";
import {
  applyBehindCameraDistanceBias,
  getLodForDistanceWithHysteresis,
  getUnloadDistForLod,
} from "./lod-utils.js";
import type {
  LoadedVoxelTile,
  PendingVoxelFetchRequest,
  PendingVoxelMeshItem,
} from "./types.js";
import { parseVoxelKey, regionWorldSize, voxelQuadrantBit } from "./utils.js";
import {
  getImmediateFinerVoxelChildren,
  getVoxelParentRegion,
  voxelTileKey,
  voxelTileKeyAtWorld,
} from "./voxel-index.js";
import { compareVoxelFetchRequests } from "./voxel-requests.js";

export function addVisibleQuadrant(
  maskMap: Map<string, number>,
  key: string,
  quadrant: number,
): void {
  maskMap.set(key, (maskMap.get(key) ?? 0) | voxelQuadrantBit(quadrant));
}

export function getTileEffectiveDist(
  cameraPosition: THREE.Vector3,
  entry: Pick<ChunkIndexEntry, "lod" | "regionX" | "regionY">,
  loadedTile?: Pick<LoadedVoxelTile, "minZ" | "maxZ">,
): number {
  const size = regionWorldSize(entry.lod);
  const dx =
    cameraPosition.x < entry.regionX
      ? entry.regionX - cameraPosition.x
      : cameraPosition.x > entry.regionX + size
        ? cameraPosition.x - (entry.regionX + size)
        : 0;
  const dy =
    cameraPosition.y < entry.regionY
      ? entry.regionY - cameraPosition.y
      : cameraPosition.y > entry.regionY + size
        ? cameraPosition.y - (entry.regionY + size)
        : 0;
  const minZ = loadedTile ? Math.min(loadedTile.minZ, loadedTile.maxZ) : null;
  const maxZ = loadedTile ? Math.max(loadedTile.minZ, loadedTile.maxZ) : null;
  const dz =
    minZ === null || maxZ === null
      ? 0
      : cameraPosition.z < minZ
        ? minZ - cameraPosition.z
        : cameraPosition.z > maxZ
          ? cameraPosition.z - maxZ
          : 0;
  return Math.hypot(dx, dy, dz);
}

export function getTileLodSelectionDist(args: {
  entry: Pick<ChunkIndexEntry, "lod" | "regionX" | "regionY">;
  loadedTile?: Pick<LoadedVoxelTile, "minZ" | "maxZ">;
  cameraPosition: THREE.Vector3;
  cameraForward: THREE.Vector3;
  voxelBehindCameraDotStart: number;
  voxelBehindCameraMaxMultiplier: number;
}): number {
  const {
    entry,
    loadedTile,
    cameraPosition,
    cameraForward,
    voxelBehindCameraDotStart,
    voxelBehindCameraMaxMultiplier,
  } = args;
  const effectiveDist = getTileEffectiveDist(cameraPosition, entry, loadedTile);
  const forwardLenSq =
    cameraForward.x * cameraForward.x + cameraForward.y * cameraForward.y;
  if (forwardLenSq <= 1e-6) return effectiveDist;

  const size = regionWorldSize(entry.lod);
  const toCenterX = entry.regionX + size / 2 - cameraPosition.x;
  const toCenterY = entry.regionY + size / 2 - cameraPosition.y;
  const toCenterLen = Math.hypot(toCenterX, toCenterY);
  if (toCenterLen <= 1e-6) return effectiveDist;

  const dot =
    (cameraForward.x * toCenterX + cameraForward.y * toCenterY) / toCenterLen;
  if (dot >= voxelBehindCameraDotStart) return effectiveDist;

  return applyBehindCameraDistanceBias({
    effectiveDist,
    objectWorldSize: size,
    dot,
    dotStart: voxelBehindCameraDotStart,
    maxMultiplier: voxelBehindCameraMaxMultiplier,
  });
}

export function getSelectionDistForLod(
  lod: number,
  voxelThresholds: { maxDist: number; lod: number }[],
  lodUnloadHysteresis: number,
  renderDistance: number,
): number {
  const unloadDist = getUnloadDistForLod(
    lod,
    voxelThresholds,
    lodUnloadHysteresis,
  );
  return Number.isFinite(unloadDist) ? unloadDist : renderDistance;
}

export function noteVoxelRequest(args: {
  requestMap: Map<string, PendingVoxelFetchRequest>;
  lod: number;
  regionX: number;
  regionY: number;
  effectiveDist: number;
  requestGeneration: number;
  getVoxelRefreshVersion: (key: string) => number;
  voxelTileKey: (lod: number, regionX: number, regionY: number) => string;
}): void {
  const {
    requestMap,
    lod,
    regionX,
    regionY,
    effectiveDist,
    requestGeneration,
    getVoxelRefreshVersion,
    voxelTileKey,
  } = args;
  const key = voxelTileKey(lod, regionX, regionY);
  const request: PendingVoxelFetchRequest = {
    key,
    lod,
    regionX,
    regionY,
    priority: LOD_LEVELS.indexOf(lod) * 100_000 + Math.round(effectiveDist),
    generation: requestGeneration,
    version: getVoxelRefreshVersion(key),
  };
  const existing = requestMap.get(key);
  if (!existing || compareVoxelFetchRequests(request, existing) < 0) {
    requestMap.set(key, request);
  }
}

export function mergeVoxelRequest(
  requestMap: Map<string, PendingVoxelFetchRequest>,
  request: PendingVoxelFetchRequest,
): void {
  const existing = requestMap.get(request.key);
  if (!existing || compareVoxelFetchRequests(request, existing) < 0) {
    requestMap.set(request.key, request);
  }
}

export function runVoxelLodSelection(args: {
  focusLod: number;
  cameraPosition: THREE.Vector3;
  cameraForward: THREE.Vector3;
  roots: ChunkIndexEntry[];
  availableVoxelKeys: Set<string>;
  loadedVoxels: Map<string, LoadedVoxelTile>;
  loadingVoxels: Set<string>;
  pendingVoxelMeshQueue: PendingVoxelMeshItem[];
  voxelUnloadGraceUntil: Map<string, number>;
  voxelThresholds: { maxDist: number; lod: number }[];
  renderDistance: number;
  minRenderedVoxelLod: number;
  requestGeneration: number;
  now: number;
  stableForDetail: boolean;
  debugSettings: {
    voxelBehindCameraDotStart: number;
    voxelBehindCameraMaxMultiplier: number;
    lodUnloadHysteresis: number;
    voxelLodHysteresisRatio: number;
    voxelAoIntensity: number;
    voxelUnloadGraceMs: number;
  };
  getVoxelRefreshVersion: (key: string) => number;
  isVoxelTileStale: (key: string) => boolean;
  unloadVoxelTile: (key: string) => void;
}): {
  detailVoxelRequests: Map<string, PendingVoxelFetchRequest>;
  committedVoxelDetailRequests: Map<string, PendingVoxelFetchRequest>;
  requestedVoxelRequests: Map<string, PendingVoxelFetchRequest>;
  debugLabelsDirty: boolean;
} {
  const {
    focusLod,
    cameraPosition,
    cameraForward,
    roots,
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
  } = args;

  if (roots.length === 0) {
    return {
      detailVoxelRequests: new Map(),
      committedVoxelDetailRequests: new Map(),
      requestedVoxelRequests: new Map(),
      debugLabelsDirty: false,
    };
  }

  const visibleQuadrantMasks = new Map<string, number>();
  const coverageVoxelRequests = new Map<string, PendingVoxelFetchRequest>();
  const detailVoxelRequests = new Map<string, PendingVoxelFetchRequest>();
  const retainedLoadedVoxelKeys = new Set<string>();
  const minAllowedLodIndex = LOD_LEVELS.indexOf(minRenderedVoxelLod);

  const clampAllowedLod = (lod: number) => {
    const lodIndex = LOD_LEVELS.indexOf(lod);
    if (lodIndex === -1) return lod;
    const boundedIndex = Math.max(lodIndex, minAllowedLodIndex);
    return LOD_LEVELS[boundedIndex] ?? lod;
  };

  const isAllowedLod = (lod: number) => {
    return lod >= minRenderedVoxelLod;
  };

  const addQuadrant = (key: string, quadrant: number) => {
    addVisibleQuadrant(visibleQuadrantMasks, key, quadrant);
  };

  const getEffectiveDist = (lod: number, regionX: number, regionY: number) => {
    const key = voxelTileKey(lod, regionX, regionY);
    return getTileEffectiveDist(
      cameraPosition,
      { lod, regionX, regionY },
      loadedVoxels.get(key),
    );
  };

  const getLodSelectionDist = (
    lod: number,
    regionX: number,
    regionY: number,
  ) => {
    return getTileLodSelectionDist({
      entry: { lod, regionX, regionY },
      loadedTile: loadedVoxels.get(voxelTileKey(lod, regionX, regionY)),
      cameraPosition,
      cameraForward,
      voxelBehindCameraDotStart: debugSettings.voxelBehindCameraDotStart,
      voxelBehindCameraMaxMultiplier:
        debugSettings.voxelBehindCameraMaxMultiplier,
    });
  };

  const getSelectionDist = (lod: number) => {
    return getSelectionDistForLod(
      lod,
      voxelThresholds,
      debugSettings.lodUnloadHysteresis,
      renderDistance,
    );
  };

  const noteRequest = (
    requestMap: Map<string, PendingVoxelFetchRequest>,
    lod: number,
    regionX: number,
    regionY: number,
    effectiveDist: number,
  ) => {
    noteVoxelRequest({
      requestMap,
      lod,
      regionX,
      regionY,
      effectiveDist,
      requestGeneration,
      getVoxelRefreshVersion,
      voxelTileKey,
    });
  };

  const selectVisibleTile = (
    entry: ChunkIndexEntry,
    hasLoadedFallback: boolean,
  ): boolean => {
    const key = voxelTileKey(entry.lod, entry.regionX, entry.regionY);
    const effectiveDist = getEffectiveDist(
      entry.lod,
      entry.regionX,
      entry.regionY,
    );
    if (effectiveDist > getSelectionDist(entry.lod)) return false;

    const lodSelectionDist = getLodSelectionDist(
      entry.lod,
      entry.regionX,
      entry.regionY,
    );
    const desiredLod = clampAllowedLod(
      getLodForDistanceWithHysteresis(
        lodSelectionDist,
        focusLod,
        voxelThresholds,
        debugSettings.voxelLodHysteresisRatio,
      ),
    );
    const loadedTile = loadedVoxels.get(key);
    const selfLoaded = !!loadedTile;
    const selfStale = isVoxelTileStale(key);
    let hasSelectedCoverage = false;
    let needsSelfFallback = false;

    if (entry.lod > desiredLod && entry.lod > minRenderedVoxelLod) {
      const children = getImmediateFinerVoxelChildren(
        entry.lod,
        entry.regionX,
        entry.regionY,
      );
      for (let quadrant = 0; quadrant < children.length; quadrant++) {
        const child = children[quadrant];
        if (!child) continue;
        const childKey = voxelTileKey(child.lod, child.regionX, child.regionY);
        const childAvailable = availableVoxelKeys.has(childKey);

        if (
          childAvailable &&
          selectVisibleTile(child, hasLoadedFallback || selfLoaded)
        ) {
          hasSelectedCoverage = true;
          continue;
        }

        needsSelfFallback = isAllowedLod(entry.lod);
        if (selfLoaded && isAllowedLod(entry.lod)) {
          addQuadrant(key, quadrant);
          hasSelectedCoverage = true;
        }
      }
    } else {
      needsSelfFallback = isAllowedLod(entry.lod);
      if (selfLoaded && isAllowedLod(entry.lod)) {
        // A partial chunkCoverage mask means some 32x32 columns are empty, not
        // that the finer tile failed to cover its valid geometry. Treat any
        // loaded tile as valid coverage so empty child columns do not force a
        // coarser parent quadrant over nearby visible detail.
        retainedLoadedVoxelKeys.add(key);
        visibleQuadrantMasks.set(key, 0b1111);
        hasSelectedCoverage = true;
      }
    }

    if (needsSelfFallback && (!selfLoaded || selfStale)) {
      noteRequest(
        hasLoadedFallback ? detailVoxelRequests : coverageVoxelRequests,
        entry.lod,
        entry.regionX,
        entry.regionY,
        effectiveDist,
      );
    }

    return hasSelectedCoverage;
  };

  for (const root of roots) {
    selectVisibleTile(root, false);
  }

  const committedVoxelDetailRequests = stableForDetail
    ? detailVoxelRequests
    : new Map<string, PendingVoxelFetchRequest>();
  const requestedVoxelRequests = new Map<string, PendingVoxelFetchRequest>();
  for (const request of coverageVoxelRequests.values()) {
    mergeVoxelRequest(requestedVoxelRequests, request);
  }
  for (const request of committedVoxelDetailRequests.values()) {
    mergeVoxelRequest(requestedVoxelRequests, request);
  }

  let debugLabelsDirty = false;
  for (const [key, tile] of loadedVoxels) {
    const quadrantMask = visibleQuadrantMasks.get(key) ?? 0;
    const visible = quadrantMask !== 0 && isAllowedLod(tile.lod);
    const effectiveDist = getEffectiveDist(
      tile.lod,
      tile.regionX,
      tile.regionY,
    );
    const unloadDist = getSelectionDist(tile.lod) * 1.1;
    const keepLoaded =
      visible ||
      coverageVoxelRequests.has(key) ||
      detailVoxelRequests.has(key) ||
      retainedLoadedVoxelKeys.has(key);

    if (keepLoaded) {
      voxelUnloadGraceUntil.set(key, now + debugSettings.voxelUnloadGraceMs);
    }

    if (tile.borderLines.visible !== visible) {
      tile.borderLines.visible = visible;
      debugLabelsDirty = true;
    }

    for (const sm of tile.subMeshes) {
      const smVisible =
        (quadrantMask & voxelQuadrantBit(sm.quadrantIndex)) !== 0;
      if (smVisible) {
        applyTopAoToSubMesh(
          tile,
          sm,
          debugSettings.voxelAoIntensity,
          visibleQuadrantMasks,
          loadedVoxels,
          requestedVoxelRequests,
        );
      }
      if (sm.mesh.visible !== smVisible) {
        sm.mesh.visible = smVisible;
        debugLabelsDirty = true;
      }
    }

    const graceUntil = voxelUnloadGraceUntil.get(key) ?? 0;
    const inGrace = now < graceUntil;

    if (!visible && !requestedVoxelRequests.has(key) && !inGrace) {
      unloadVoxelTile(key);
      debugLabelsDirty = true;
      continue;
    }

    if (
      !requestedVoxelRequests.has(key) &&
      !inGrace &&
      (effectiveDist > unloadDist || !isAllowedLod(tile.lod))
    ) {
      unloadVoxelTile(key);
      debugLabelsDirty = true;
    }
  }

  for (const key of [...loadingVoxels]) {
    const parsed = parseVoxelKey(key);
    if (!parsed) continue;
    const effectiveDist = getEffectiveDist(
      parsed.lod,
      parsed.regionX,
      parsed.regionY,
    );
    if (
      !requestedVoxelRequests.has(key) &&
      (effectiveDist > getSelectionDist(parsed.lod) * 1.1 ||
        !isAllowedLod(parsed.lod))
    ) {
      loadingVoxels.delete(key);
      pendingVoxelMeshQueue.splice(
        0,
        pendingVoxelMeshQueue.length,
        ...pendingVoxelMeshQueue.filter((q) => q.key !== key),
      );
    }
  }

  return {
    detailVoxelRequests,
    committedVoxelDetailRequests,
    requestedVoxelRequests,
    debugLabelsDirty,
  };
}

function applyTopAoToSubMesh(
  tile: LoadedVoxelTile,
  subMesh: LoadedVoxelTile["subMeshes"][number],
  aoIntensity: number,
  visibleQuadrantMasks: Map<string, number>,
  loadedVoxels: Map<string, LoadedVoxelTile>,
  requestedVoxelRequests: Map<string, PendingVoxelFetchRequest>,
): void {
  const topAoEnabled = VOXEL_TOP_AO.enabledLods.includes(
    tile.lod as (typeof VOXEL_TOP_AO.enabledLods)[number],
  );
  if (!topAoEnabled || aoIntensity <= 0) {
    restoreSubMeshBaseColors(subMesh);
    return;
  }

  const geometry = subMesh.mesh.geometry;
  const colorAttr = geometry.getAttribute("color");
  const positionAttr = geometry.getAttribute("position");
  const normalAttr = geometry.getAttribute("normal");
  if (!colorAttr || !positionAttr || !normalAttr) return;

  const boundaryState = getAoBoundaryState(
    tile,
    subMesh.quadrantIndex,
    visibleQuadrantMasks,
    loadedVoxels,
    requestedVoxelRequests,
  );
  const intensityKey = Math.round(aoIntensity * 100);
  const signature = `${boundaryState.west}${boundaryState.east}${boundaryState.south}${boundaryState.north}:${intensityKey}`;
  if (subMesh.aoBoundarySignature === signature) {
    return;
  }

  const colors = colorAttr.array as Float32Array;
  colors.set(subMesh.baseColors);
  const regionSize = regionWorldSize(tile.lod);
  const blendWorld = VOXEL_TOP_AO.seamBlendCells * tile.voxelSize;

  for (let i = 0; i < positionAttr.count; i++) {
    const normalZ = normalAttr.getZ(i);
    if (normalZ < 0.5) continue;
    const aoLevel = subMesh.faceAo[i] ?? 0;
    if (aoLevel <= 0) continue;

    const worldX = positionAttr.getX(i);
    const worldY = positionAttr.getY(i);
    const localX = worldX - tile.regionX;
    const localY = worldY - tile.regionY;
    const seamLift = getAoSeamLift(
      localX,
      localY,
      regionSize,
      blendWorld,
      boundaryState,
    );
    const minShade = THREE.MathUtils.lerp(
      VOXEL_TOP_AO.minShade,
      VOXEL_TOP_AO.seamMinShade,
      seamLift,
    );
    const shade = THREE.MathUtils.lerp(
      1,
      minShade,
      Math.min(1, (aoLevel / 3) * aoIntensity),
    );
    colors[i * 3] *= shade;
    colors[i * 3 + 1] *= shade;
    colors[i * 3 + 2] *= shade;
  }

  colorAttr.needsUpdate = true;
  subMesh.aoBoundarySignature = signature;
}

function restoreSubMeshBaseColors(
  subMesh: LoadedVoxelTile["subMeshes"][number],
): void {
  if (subMesh.aoBoundarySignature === "") return;
  const colorAttr = subMesh.mesh.geometry.getAttribute("color");
  if (!colorAttr) return;
  (colorAttr.array as Float32Array).set(subMesh.baseColors);
  colorAttr.needsUpdate = true;
  subMesh.aoBoundarySignature = "";
}

function getAoBoundaryState(
  tile: LoadedVoxelTile,
  quadrantIndex: number,
  visibleQuadrantMasks: Map<string, number>,
  loadedVoxels: Map<string, LoadedVoxelTile>,
  requestedVoxelRequests: Map<string, PendingVoxelFetchRequest>,
): { west: number; east: number; south: number; north: number } {
  const regionSize = regionWorldSize(tile.lod);
  const halfSize = regionSize / 2;
  const offsetX = quadrantIndex % 2 === 1 ? halfSize : 0;
  const offsetY = quadrantIndex >= 2 ? halfSize : 0;

  return {
    west: getAoEdgeState(
      tile,
      visibleQuadrantMasks,
      loadedVoxels,
      requestedVoxelRequests,
      tile.regionX + offsetX - 1,
      tile.regionY + offsetY,
    ),
    east: getAoEdgeState(
      tile,
      visibleQuadrantMasks,
      loadedVoxels,
      requestedVoxelRequests,
      tile.regionX + offsetX + halfSize,
      tile.regionY + offsetY,
    ),
    south: getAoEdgeState(
      tile,
      visibleQuadrantMasks,
      loadedVoxels,
      requestedVoxelRequests,
      tile.regionX + offsetX,
      tile.regionY + offsetY - 1,
    ),
    north: getAoEdgeState(
      tile,
      visibleQuadrantMasks,
      loadedVoxels,
      requestedVoxelRequests,
      tile.regionX + offsetX,
      tile.regionY + offsetY + halfSize,
    ),
  };
}

function getAoEdgeState(
  tile: LoadedVoxelTile,
  visibleQuadrantMasks: Map<string, number>,
  loadedVoxels: Map<string, LoadedVoxelTile>,
  requestedVoxelRequests: Map<string, PendingVoxelFetchRequest>,
  sampleX: number,
  sampleY: number,
): number {
  const sameKey = voxelTileKeyAtWorld(tile.lod, sampleX, sampleY);
  const sameMask = visibleQuadrantMasks.get(sameKey) ?? 0;
  if (sameMask !== 0 && loadedVoxels.has(sameKey)) {
    return 0;
  }

  const parent = getVoxelParentRegion(tile.lod, tile.regionX, tile.regionY);
  if (parent) {
    const parentKey = voxelTileKeyAtWorld(parent.lod, sampleX, sampleY);
    if ((visibleQuadrantMasks.get(parentKey) ?? 0) !== 0) {
      return 1;
    }
  }

  const childKey =
    tile.lod > 1 ? voxelTileKeyAtWorld(tile.lod / 2, sampleX, sampleY) : null;
  if (childKey && (visibleQuadrantMasks.get(childKey) ?? 0) !== 0) {
    return 1;
  }

  return requestedVoxelRequests.has(sameKey) ? 1 : 0;
}

function getAoSeamLift(
  localX: number,
  localY: number,
  regionSize: number,
  blendWorld: number,
  boundaryState: { west: number; east: number; south: number; north: number },
): number {
  let lift = 0;

  if (boundaryState.west !== 0) {
    lift = Math.max(lift, edgeBlend(localX, blendWorld));
  }
  if (boundaryState.east !== 0) {
    lift = Math.max(lift, edgeBlend(regionSize - localX, blendWorld));
  }
  if (boundaryState.south !== 0) {
    lift = Math.max(lift, edgeBlend(localY, blendWorld));
  }
  if (boundaryState.north !== 0) {
    lift = Math.max(lift, edgeBlend(regionSize - localY, blendWorld));
  }

  return lift;
}

function edgeBlend(distanceToEdge: number, blendWorld: number): number {
  if (blendWorld <= 0) return 1;
  return 1 - THREE.MathUtils.clamp(distanceToEdge / blendWorld, 0, 1);
}
