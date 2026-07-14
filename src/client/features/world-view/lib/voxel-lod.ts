import * as THREE from "three";
import type { ChunkIndexEntry } from "../hooks/useWorldData.js";

import { LOD_LEVELS } from "./constants.js";
import { VOXEL_TOP_AO, VOXEL_WALL_AO } from "./daylight.js";
import {
  applyBehindCameraDistanceBias,
  getLodForDistance,
  getLodForDistanceWithHysteresis,
  getUnloadDistForLod,
} from "./lod-utils.js";
import type {
  LoadedVoxelTile,
  PendingVoxelFetchRequest,
  PendingVoxelMeshItem,
  WarmCachedVoxelTile,
} from "./types.js";
import { parseVoxelKey, regionWorldSize, voxelQuadrantBit } from "./utils.js";
import {
  getImmediateFinerVoxelChildren,
  getVoxelParentRegion,
  voxelTileKey,
  voxelTileKeyAtWorld,
} from "./voxel-index.js";
import { compareVoxelFetchRequests } from "./voxel-requests.js";
import {
  clampVoxelRefinementLod,
  classifyVoxelView,
  getReferenceVoxelViewBounds,
  type VoxelViewBounds,
} from "./voxel-view.js";
import type { VoxelCoverageClass, VoxelViewClass } from "./voxel-work.js";

const TOP_HEIGHT_GRID_SIZE = 4;
const FOCUS_REFINEMENT_RADIUS_MULTIPLIER = 0.5;

type TileEntry = Pick<ChunkIndexEntry, "lod" | "regionX" | "regionY">;

function addVisibleQuadrant(
  maskMap: Map<string, number>,
  key: string,
  quadrant: number,
): void {
  maskMap.set(key, (maskMap.get(key) ?? 0) | voxelQuadrantBit(quadrant));
}

function getTileEffectiveDist(
  cameraPosition: THREE.Vector3,
  entry: TileEntry,
  referenceSurfaceZ: number,
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
  const dz = Math.max(0, cameraPosition.z - referenceSurfaceZ);
  return Math.hypot(dx, dy, dz);
}

function getDistanceToTileHorizontalBounds(
  point: THREE.Vector3,
  entry: TileEntry,
): number {
  const size = regionWorldSize(entry.lod);
  const dx =
    point.x < entry.regionX
      ? entry.regionX - point.x
      : point.x > entry.regionX + size
        ? point.x - (entry.regionX + size)
        : 0;
  const dy =
    point.y < entry.regionY
      ? entry.regionY - point.y
      : point.y > entry.regionY + size
        ? point.y - (entry.regionY + size)
        : 0;
  return Math.hypot(dx, dy);
}

function getTileTopHeightAtPoint(
  tile: LoadedVoxelTile,
  point: THREE.Vector3 | null,
): number | null {
  if (!point || tile.chunkTopHeights.length !== TOP_HEIGHT_GRID_SIZE ** 2) {
    return null;
  }

  const size = regionWorldSize(tile.lod);
  const localX = point.x - tile.regionX;
  const localY = point.y - tile.regionY;
  if (localX < 0 || localX > size || localY < 0 || localY > size) return null;

  const cellX = Math.min(
    TOP_HEIGHT_GRID_SIZE - 1,
    Math.max(0, Math.floor((localX / size) * TOP_HEIGHT_GRID_SIZE)),
  );
  const cellY = Math.min(
    TOP_HEIGHT_GRID_SIZE - 1,
    Math.max(0, Math.floor((localY / size) * TOP_HEIGHT_GRID_SIZE)),
  );
  const height = tile.chunkTopHeights[cellY * TOP_HEIGHT_GRID_SIZE + cellX];
  return Number.isFinite(height) ? height : null;
}

function getLoadedTileVerticalBounds(
  tile: LoadedVoxelTile,
  samplePoint: THREE.Vector3 | null,
): { minZ: number; maxZ: number } {
  const sampledTopHeight = getTileTopHeightAtPoint(tile, samplePoint);
  const minZ = Number.isFinite(tile.minZ) ? tile.minZ : 0;
  const maxZ = Math.max(
    minZ,
    Number.isFinite(tile.maxZ) ? tile.maxZ : minZ,
    sampledTopHeight ?? Number.NEGATIVE_INFINITY,
  );
  return { minZ, maxZ };
}

function getLoadedTileBoundsDistance(args: {
  cameraPosition: THREE.Vector3;
  tile: LoadedVoxelTile;
  focusPoint: THREE.Vector3 | null;
}): number {
  const { cameraPosition, tile, focusPoint } = args;
  const size = regionWorldSize(tile.lod);
  const dx =
    cameraPosition.x < tile.regionX
      ? tile.regionX - cameraPosition.x
      : cameraPosition.x > tile.regionX + size
        ? cameraPosition.x - (tile.regionX + size)
        : 0;
  const dy =
    cameraPosition.y < tile.regionY
      ? tile.regionY - cameraPosition.y
      : cameraPosition.y > tile.regionY + size
        ? cameraPosition.y - (tile.regionY + size)
        : 0;
  const bounds = getLoadedTileVerticalBounds(
    tile,
    focusPoint ?? cameraPosition,
  );
  const dz =
    cameraPosition.z < bounds.minZ
      ? bounds.minZ - cameraPosition.z
      : cameraPosition.z > bounds.maxZ
        ? cameraPosition.z - bounds.maxZ
        : 0;
  return Math.hypot(dx, dy, dz);
}

function estimateProjectedTileSizePixels(args: {
  tileWorldSize: number;
  distance: number;
  cameraFov: number;
  viewportHeight: number;
}): number {
  const { tileWorldSize, distance, cameraFov, viewportHeight } = args;
  if (
    tileWorldSize <= 0 ||
    distance <= 0 ||
    !Number.isFinite(distance) ||
    !Number.isFinite(cameraFov) ||
    cameraFov <= 0 ||
    !Number.isFinite(viewportHeight) ||
    viewportHeight <= 0
  ) {
    return Infinity;
  }

  return (
    (tileWorldSize / distance) *
    (viewportHeight / (2 * Math.tan((cameraFov * Math.PI) / 360)))
  );
}

function getTileLodSelectionDist(args: {
  entry: TileEntry;
  effectiveDist: number;
  cameraPosition: THREE.Vector3;
  cameraForward: THREE.Vector3;
  voxelBehindCameraDotStart: number;
  voxelBehindCameraMaxMultiplier: number;
  screenSpaceDistanceScale: number;
}): number {
  const {
    entry,
    effectiveDist,
    cameraPosition,
    cameraForward,
    voxelBehindCameraDotStart,
    voxelBehindCameraMaxMultiplier,
    screenSpaceDistanceScale,
  } = args;
  const forwardLenSq =
    cameraForward.x * cameraForward.x + cameraForward.y * cameraForward.y;
  if (forwardLenSq <= 1e-6) return effectiveDist * screenSpaceDistanceScale;

  const size = regionWorldSize(entry.lod);
  const toCenterX = entry.regionX + size / 2 - cameraPosition.x;
  const toCenterY = entry.regionY + size / 2 - cameraPosition.y;
  const toCenterLen = Math.hypot(toCenterX, toCenterY);
  if (toCenterLen <= 1e-6) return effectiveDist * screenSpaceDistanceScale;

  const dot =
    (cameraForward.x * toCenterX + cameraForward.y * toCenterY) /
    (Math.sqrt(forwardLenSq) * toCenterLen);
  if (dot >= voxelBehindCameraDotStart) {
    return effectiveDist * screenSpaceDistanceScale;
  }

  return (
    applyBehindCameraDistanceBias({
      effectiveDist,
      objectWorldSize: size,
      dot,
      dotStart: voxelBehindCameraDotStart,
      maxMultiplier: voxelBehindCameraMaxMultiplier,
    }) * screenSpaceDistanceScale
  );
}

function getSelectionDistForLod(
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

function noteVoxelRequest(args: {
  requestMap: Map<string, PendingVoxelFetchRequest>;
  lod: number;
  regionX: number;
  regionY: number;
  effectiveDist: number;
  coverageClass: VoxelCoverageClass;
  viewClass: VoxelViewClass;
  projectedBenefit: number;
  requestGeneration: number;
  selectedAt: number;
  getVoxelRefreshVersion: (key: string) => number;
  voxelTileKey: (lod: number, regionX: number, regionY: number) => string;
}): void {
  const {
    requestMap,
    lod,
    regionX,
    regionY,
    effectiveDist,
    coverageClass,
    viewClass,
    projectedBenefit,
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
    priority: {
      coverageClass,
      viewClass,
      projectedBenefit,
      distance: effectiveDist,
      lod,
      generation: requestGeneration,
    },
    generation: requestGeneration,
    version: getVoxelRefreshVersion(key),
    selectedAt: args.selectedAt,
  };
  const existing = requestMap.get(key);
  if (!existing || compareVoxelFetchRequests(request, existing) < 0) {
    requestMap.set(key, request);
  }
}

function mergeVoxelRequest(
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
  referenceSurfaceZ: number;
  cameraForward: THREE.Vector3;
  screenSpaceDistanceScale: number;
  cameraFov: number;
  viewportHeight: number;
  viewportAspect: number;
  focusPoint: THREE.Vector3 | null;
  roots: ChunkIndexEntry[];
  availableVoxelKeys: Set<string>;
  loadedVoxels: Map<string, LoadedVoxelTile>;
  warmCachedVoxels: Map<string, WarmCachedVoxelTile>;
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
    voxelTopAoIntensity: number;
    voxelWallAoIntensity: number;
    voxelUnloadGraceMs: number;
    voxelViewEnterMarginDegrees: number;
    voxelViewExitMarginDegrees: number;
  };
  voxelViewClasses: Map<string, VoxelViewClass>;
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
    referenceSurfaceZ,
    cameraForward,
    screenSpaceDistanceScale,
    cameraFov,
    viewportHeight,
    viewportAspect,
    focusPoint,
    roots,
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
    now,
    stableForDetail,
    debugSettings,
    voxelViewClasses,
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
  const visitedViewKeys = new Set<string>();
  const rootKeys = new Set(
    roots.map((root) => voxelTileKey(root.lod, root.regionX, root.regionY)),
  );
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
    const knownTile = loadedVoxels.get(key) ?? warmCachedVoxels.get(key)?.tile;
    if (knownTile) {
      return getLoadedTileBoundsDistance({
        cameraPosition,
        tile: knownTile,
        focusPoint,
      });
    }

    return getTileEffectiveDist(
      cameraPosition,
      { lod, regionX, regionY },
      referenceSurfaceZ,
    );
  };

  const getViewBounds = (
    lod: number,
    regionX: number,
    regionY: number,
  ): VoxelViewBounds => {
    const key = voxelTileKey(lod, regionX, regionY);
    const loadedTile = loadedVoxels.get(key) ?? warmCachedVoxels.get(key)?.tile;
    const worldSize = regionWorldSize(lod);
    if (!loadedTile) {
      return getReferenceVoxelViewBounds({
        regionX,
        regionY,
        worldSize,
        referenceSurfaceZ,
      });
    }
    const verticalBounds = getLoadedTileVerticalBounds(
      loadedTile,
      focusPoint ?? cameraPosition,
    );
    return {
      minX: regionX,
      maxX: regionX + worldSize,
      minY: regionY,
      maxY: regionY + worldSize,
      minZ: verticalBounds.minZ,
      maxZ: verticalBounds.maxZ,
    };
  };

  const getViewClass = (
    lod: number,
    regionX: number,
    regionY: number,
  ): VoxelViewClass => {
    const key = voxelTileKey(lod, regionX, regionY);
    visitedViewKeys.add(key);
    if (focusPoint) {
      const focusDistance = getDistanceToTileHorizontalBounds(focusPoint, {
        lod,
        regionX,
        regionY,
      });
      if (
        focusDistance <=
        regionWorldSize(lod) * FOCUS_REFINEMENT_RADIUS_MULTIPLIER
      ) {
        voxelViewClasses.set(key, "focus");
        return "focus";
      }
    }
    const viewClass = classifyVoxelView({
      cameraPosition,
      cameraDirection: cameraForward,
      verticalFovDegrees: cameraFov,
      viewportAspect,
      bounds: getViewBounds(lod, regionX, regionY),
      enterMarginDegrees: debugSettings.voxelViewEnterMarginDegrees,
      exitMarginDegrees: debugSettings.voxelViewExitMarginDegrees,
      previousClass: voxelViewClasses.get(key),
    });
    voxelViewClasses.set(key, viewClass);
    return viewClass;
  };

  const getProjectedBenefit = (lod: number, effectiveDist: number): number => {
    const projectedSize = estimateProjectedTileSizePixels({
      tileWorldSize: regionWorldSize(lod),
      distance: effectiveDist,
      cameraFov,
      viewportHeight,
    });
    return Number.isFinite(projectedSize) ? projectedSize : Number.MAX_VALUE;
  };

  const getLodSelectionDist = (
    lod: number,
    regionX: number,
    regionY: number,
    effectiveDist: number,
  ) => {
    let selectionDist = getTileLodSelectionDist({
      entry: { lod, regionX, regionY },
      effectiveDist,
      cameraPosition,
      cameraForward,
      voxelBehindCameraDotStart: debugSettings.voxelBehindCameraDotStart,
      voxelBehindCameraMaxMultiplier:
        debugSettings.voxelBehindCameraMaxMultiplier,
      screenSpaceDistanceScale,
    });

    if (focusPoint) {
      const focusDistance = getDistanceToTileHorizontalBounds(focusPoint, {
        lod,
        regionX,
        regionY,
      });
      const focusRefinementRadius =
        regionWorldSize(lod) * FOCUS_REFINEMENT_RADIUS_MULTIPLIER;
      if (focusDistance <= focusRefinementRadius) {
        selectionDist = Math.min(
          selectionDist,
          focusDistance * screenSpaceDistanceScale,
        );
      }
    }

    return selectionDist;
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
    coverageClass: VoxelCoverageClass,
  ) => {
    const viewClass = getViewClass(lod, regionX, regionY);
    noteVoxelRequest({
      requestMap,
      lod,
      regionX,
      regionY,
      effectiveDist,
      coverageClass,
      viewClass,
      projectedBenefit: getProjectedBenefit(lod, effectiveDist),
      requestGeneration,
      selectedAt: now,
      getVoxelRefreshVersion,
      voxelTileKey,
    });
  };

  const selectVisibleTile = (
    entry: ChunkIndexEntry,
    hasLoadedFallback: boolean,
    isRoot = false,
  ): boolean => {
    const key = voxelTileKey(entry.lod, entry.regionX, entry.regionY);
    const effectiveDist = getEffectiveDist(
      entry.lod,
      entry.regionX,
      entry.regionY,
    );
    const scaledEffectiveDist = effectiveDist * screenSpaceDistanceScale;
    if (
      isRoot
        ? effectiveDist > renderDistance
        : scaledEffectiveDist > getSelectionDist(entry.lod)
    ) {
      return false;
    }

    const lodSelectionDist = getLodSelectionDist(
      entry.lod,
      entry.regionX,
      entry.regionY,
      effectiveDist,
    );
    const loadedTile = loadedVoxels.get(key);
    const viewClass = getViewClass(entry.lod, entry.regionX, entry.regionY);
    const projectedTileSizePixels = loadedTile
      ? estimateProjectedTileSizePixels({
          tileWorldSize: regionWorldSize(entry.lod),
          distance: effectiveDist,
          cameraFov,
          viewportHeight,
        })
      : 0;
    const projectedDesiredLod =
      projectedTileSizePixels > 0
        ? getLodForDistance(lodSelectionDist, voxelThresholds)
        : null;
    const hysteresisDesiredLod = getLodForDistanceWithHysteresis(
      lodSelectionDist,
      focusLod,
      voxelThresholds,
      debugSettings.voxelLodHysteresisRatio,
    );
    const desiredLod = clampAllowedLod(
      clampVoxelRefinementLod(
        projectedDesiredLod === null
          ? hysteresisDesiredLod
          : Math.min(projectedDesiredLod, hysteresisDesiredLod),
        viewClass,
      ),
    );
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
        const childAvailable =
          availableVoxelKeys.has(childKey) || loadedVoxels.has(childKey);

        if (
          childAvailable &&
          selectVisibleTile(child, hasLoadedFallback || selfLoaded)
        ) {
          hasSelectedCoverage = true;
          continue;
        }

        const childEffectiveDist = getEffectiveDist(
          child.lod,
          child.regionX,
          child.regionY,
        );
        const childSelectionDist = getLodSelectionDist(
          child.lod,
          child.regionX,
          child.regionY,
          childEffectiveDist,
        );
        // The index is authoritative for available child payloads. Without
        // this guard, a filtered validation index can still trigger requests
        // for unadvertised finer regions.
        if (
          childAvailable &&
          childSelectionDist <= getSelectionDist(child.lod) &&
          isAllowedLod(child.lod)
        ) {
          noteRequest(
            hasLoadedFallback || selfLoaded
              ? detailVoxelRequests
              : coverageVoxelRequests,
            child.lod,
            child.regionX,
            child.regionY,
            childEffectiveDist,
            hasLoadedFallback || selfLoaded ? "detail" : "coverage",
          );
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
        hasLoadedFallback ? "detail" : "coverage",
      );
    }

    return hasSelectedCoverage;
  };

  for (const root of roots) {
    selectVisibleTile(root, false, true);
  }
  for (const key of voxelViewClasses.keys()) {
    if (!visitedViewKeys.has(key)) voxelViewClasses.delete(key);
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
    const scaledEffectiveDist = effectiveDist * screenSpaceDistanceScale;
    const unloadDist = rootKeys.has(key)
      ? renderDistance * 1.1
      : getSelectionDist(tile.lod) * 1.1;
    const eligibilityDist = rootKeys.has(key)
      ? effectiveDist
      : scaledEffectiveDist;
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

    for (const sm of [...tile.subMeshes, ...tile.transparentSubMeshes]) {
      const smVisible =
        (quadrantMask & voxelQuadrantBit(sm.quadrantIndex)) !== 0;
      if (smVisible) {
        applyVoxelAoToSubMesh(
          tile,
          sm,
          debugSettings.voxelTopAoIntensity,
          debugSettings.voxelWallAoIntensity,
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
      (eligibilityDist > unloadDist || !isAllowedLod(tile.lod))
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
    const scaledEffectiveDist = effectiveDist * screenSpaceDistanceScale;
    const eligibilityDist = rootKeys.has(key)
      ? effectiveDist
      : scaledEffectiveDist;
    const unloadDist = rootKeys.has(key)
      ? renderDistance * 1.1
      : getSelectionDist(parsed.lod) * 1.1;
    if (
      !requestedVoxelRequests.has(key) &&
      (eligibilityDist > unloadDist || !isAllowedLod(parsed.lod))
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

function applyVoxelAoToSubMesh(
  tile: LoadedVoxelTile,
  subMesh: LoadedVoxelTile["subMeshes"][number],
  topAoIntensity: number,
  wallAoIntensity: number,
  visibleQuadrantMasks: Map<string, number>,
  loadedVoxels: Map<string, LoadedVoxelTile>,
  requestedVoxelRequests: Map<string, PendingVoxelFetchRequest>,
): void {
  const topAoEnabled = VOXEL_TOP_AO.enabledLods.includes(
    tile.lod as (typeof VOXEL_TOP_AO.enabledLods)[number],
  );
  const wallAoEnabled = VOXEL_WALL_AO.enabledLods.includes(
    tile.lod as (typeof VOXEL_WALL_AO.enabledLods)[number],
  );
  if (
    (!topAoEnabled && !wallAoEnabled) ||
    (topAoIntensity <= 0 && wallAoIntensity <= 0)
  ) {
    restoreSubMeshBaseColors(subMesh);
    return;
  }

  const geometry = subMesh.mesh.geometry;
  const colorAttr = geometry.getAttribute("color");
  const positionAttr = geometry.getAttribute("position");
  const normalAttr = geometry.getAttribute("normal");
  if (!colorAttr || !positionAttr || !normalAttr) return;

  const topIntensityKey = Math.round(topAoIntensity * 100);
  const wallIntensityKey = Math.round(wallAoIntensity * 100);
  const boundaryState = topAoEnabled
    ? getAoBoundaryState(
        tile,
        subMesh.quadrantIndex,
        visibleQuadrantMasks,
        loadedVoxels,
        requestedVoxelRequests,
      )
    : null;
  const signature = boundaryState
    ? `${boundaryState.west}${boundaryState.east}${boundaryState.south}${boundaryState.north}:${topIntensityKey}:${wallIntensityKey}`
    : `wall:${topIntensityKey}:${wallIntensityKey}`;
  if (subMesh.aoBoundarySignature === signature) {
    return;
  }

  const colors = colorAttr.array as Float32Array;
  colors.set(subMesh.baseColors);
  const regionSize = topAoEnabled ? regionWorldSize(tile.lod) : 0;
  const blendWorld = topAoEnabled
    ? VOXEL_TOP_AO.seamBlendCells * tile.voxelSize
    : 0;

  for (let i = 0; i < positionAttr.count; i++) {
    const normalZ = normalAttr.getZ(i);
    const aoLevel = subMesh.faceAo[i] ?? 0;
    if (aoLevel <= 0) continue;

    const topFace = topAoEnabled && normalZ >= 0.5;
    const wallFace = wallAoEnabled && Math.abs(normalZ) < 0.5;
    if (!topFace && !wallFace) continue;

    let shade = 1;
    if (topFace && boundaryState) {
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
      shade = THREE.MathUtils.lerp(
        1,
        minShade,
        getTopAoWeight(aoLevel, topAoIntensity),
      );
    } else if (wallFace) {
      shade = THREE.MathUtils.lerp(
        1,
        VOXEL_WALL_AO.minShade,
        getWallAoWeight(aoLevel, wallAoIntensity),
      );
    }

    colors[i * 3] *= shade;
    colors[i * 3 + 1] *= shade;
    colors[i * 3 + 2] *= shade;
  }

  colorAttr.needsUpdate = true;
  subMesh.aoBoundarySignature = signature;
}

function getWallAoWeight(aoLevel: number, aoIntensity: number): number {
  const clampedIntensity = Math.max(0, aoIntensity);
  const baseWeight =
    aoLevel >= 3 ? 1 : aoLevel === 2 ? 0.58 : aoLevel === 1 ? 0.03 : 0;
  return Math.min(1, baseWeight * clampedIntensity);
}

function getTopAoWeight(aoLevel: number, aoIntensity: number): number {
  const clampedIntensity = Math.max(0, aoIntensity);
  const baseWeight =
    aoLevel >= 3 ? 1 : aoLevel === 2 ? 0.22 : aoLevel === 1 ? 0.05 : 0;
  return Math.min(1, baseWeight * clampedIntensity);
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
