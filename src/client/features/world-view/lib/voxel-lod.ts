import * as THREE from "three";
import type { ChunkIndexEntry } from "../hooks/useWorldData.js";

import { LOD_LEVELS } from "./constants.js";
import {
  getLodForDistanceWithHysteresis,
  getUnloadDistForLod,
} from "./lod-utils.js";
import type {
  LoadedVoxelTile,
  PendingVoxelFetchRequest,
  PendingVoxelMeshItem,
} from "./types.js";
import {
  isVoxelTileComplete,
  parseVoxelKey,
  regionWorldSize,
  voxelQuadrantBit,
} from "./utils.js";
import { getImmediateFinerVoxelChildren, voxelTileKey } from "./voxel-index.js";
import { compareVoxelFetchRequests } from "./voxel-requests.js";

export function addVisibleQuadrant(
  maskMap: Map<string, number>,
  key: string,
  quadrant: number,
): void {
  maskMap.set(key, (maskMap.get(key) ?? 0) | voxelQuadrantBit(quadrant));
}

export function getTileEffectiveDist(
  target: THREE.Vector3,
  camDist: number,
  lod: number,
  regionX: number,
  regionY: number,
): number {
  const size = regionWorldSize(lod);
  const dx =
    target.x < regionX
      ? regionX - target.x
      : target.x > regionX + size
        ? target.x - (regionX + size)
        : 0;
  const dy =
    target.y < regionY
      ? regionY - target.y
      : target.y > regionY + size
        ? target.y - (regionY + size)
        : 0;
  return Math.max(Math.hypot(dx, dy), camDist);
}

export function getTileLodSelectionDist(args: {
  target: THREE.Vector3;
  camDist: number;
  lod: number;
  regionX: number;
  regionY: number;
  cameraPosition: THREE.Vector3;
  cameraForward: THREE.Vector3;
  voxelBehindCameraDotStart: number;
  voxelBehindCameraMaxMultiplier: number;
}): number {
  const {
    target,
    camDist,
    lod,
    regionX,
    regionY,
    cameraPosition,
    cameraForward,
    voxelBehindCameraDotStart,
    voxelBehindCameraMaxMultiplier,
  } = args;
  const effectiveDist = getTileEffectiveDist(
    target,
    camDist,
    lod,
    regionX,
    regionY,
  );
  const forwardLenSq =
    cameraForward.x * cameraForward.x + cameraForward.y * cameraForward.y;
  if (forwardLenSq <= 1e-6) return effectiveDist;

  const size = regionWorldSize(lod);
  const toCenterX = regionX + size / 2 - cameraPosition.x;
  const toCenterY = regionY + size / 2 - cameraPosition.y;
  const toCenterLen = Math.hypot(toCenterX, toCenterY);
  if (toCenterLen <= 1e-6) return effectiveDist;

  const dot =
    (cameraForward.x * toCenterX + cameraForward.y * toCenterY) / toCenterLen;
  if (dot >= voxelBehindCameraDotStart) return effectiveDist;

  const blend = THREE.MathUtils.clamp(
    (-dot + voxelBehindCameraDotStart) / (1 + voxelBehindCameraDotStart),
    0,
    1,
  );
  const multiplier = THREE.MathUtils.lerp(
    1,
    voxelBehindCameraMaxMultiplier,
    blend,
  );
  return effectiveDist * multiplier;
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
  target: THREE.Vector3;
  camDist: number;
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
    target,
    camDist,
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
    return getTileEffectiveDist(target, camDist, lod, regionX, regionY);
  };

  const getLodSelectionDist = (
    lod: number,
    regionX: number,
    regionY: number,
  ) => {
    return getTileLodSelectionDist({
      target,
      camDist,
      lod,
      regionX,
      regionY,
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
    const selfComplete = loadedTile
      ? isVoxelTileComplete(loadedTile.chunkCoverage)
      : false;
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
      if (selfLoaded && selfComplete && isAllowedLod(entry.lod)) {
        visibleQuadrantMasks.set(key, 0b1111);
        hasSelectedCoverage = true;
      } else if (selfLoaded && isAllowedLod(entry.lod)) {
        retainedLoadedVoxelKeys.add(key);
        if (!hasLoadedFallback) {
          visibleQuadrantMasks.set(key, 0b1111);
        }
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
