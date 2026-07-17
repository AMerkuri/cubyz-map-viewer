import type { QueryClient } from "@tanstack/react-query";
import type * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";

import {
  expandVoxelInvalidationBatch,
  isSupportedVoxelLod,
  type VoxelInvalidationRegion,
} from "../../../../server/services/voxel-invalidation.js";
import { terrainTileKey } from "./terrain-manager.js";
import type {
  LoadedTerrainTile,
  LoadedVoxelTile,
  PendingVoxelFetchRequest,
  PendingVoxelMeshItem,
} from "./types.js";
import { voxelTileKey } from "./voxel-index.js";

export function handleTerrainTileUpdate(args: {
  lod: number;
  tileX: number;
  tileY: number;
  queryClient: QueryClient;
  showTerrainUnderlay: boolean;
  loadedTerrain: Map<string, LoadedTerrainTile>;
  evictWarmCachedTerrainTile: (key: string) => void;
  queueTerrainTileLoad: (
    lod: number,
    tileX: number,
    tileY: number,
    priority: number,
  ) => void;
  disposeTerrainTile: (tile: LoadedTerrainTile) => void;
  debugLabelsDirtyRef: { current: boolean };
  biomeLabelsDirtyRef: { current: boolean };
}): void {
  const {
    lod,
    tileX,
    tileY,
    queryClient,
    showTerrainUnderlay,
    loadedTerrain,
    evictWarmCachedTerrainTile,
    queueTerrainTileLoad,
    disposeTerrainTile,
    debugLabelsDirtyRef,
    biomeLabelsDirtyRef,
  } = args;

  for (let offsetX = -1; offsetX <= 1; offsetX++) {
    for (let offsetY = -1; offsetY <= 1; offsetY++) {
      const affectedTileX = tileX + offsetX;
      const affectedTileY = tileY + offsetY;
      queryClient.invalidateQueries({
        queryKey: ["terrain", lod, affectedTileX, affectedTileY],
      });

      const key = terrainTileKey(lod, affectedTileX, affectedTileY);
      evictWarmCachedTerrainTile(key);
      const existing = loadedTerrain.get(key);
      if (existing) {
        disposeTerrainTile(existing);
        loadedTerrain.delete(key);
      }

      if (showTerrainUnderlay) {
        queueTerrainTileLoad(
          lod,
          affectedTileX,
          affectedTileY,
          Number.NEGATIVE_INFINITY,
        );
      }
    }
  }
  queryClient.invalidateQueries({ queryKey: ["biomes", lod, tileX, tileY] });

  debugLabelsDirtyRef.current = true;
  biomeLabelsDirtyRef.current = true;
}

export function handleVoxelRegionUpdates(args: {
  regions: Array<{ lod: number; regionX: number; regionY: number }>;
  scene: { camera: THREE.PerspectiveCamera; controls: OrbitControls } | null;
  loadedVoxels: Map<string, LoadedVoxelTile>;
  availableVoxelKeys: Set<string>;
  missingVoxels: Set<string>;
  failedVoxels: Map<string, number>;
  loadingVoxels: Set<string>;
  voxelFetchControllers: Map<string, AbortController>;
  pendingVoxelFetchQueueRef: { current: PendingVoxelFetchRequest[] };
  pendingVoxelMeshQueueRef: { current: PendingVoxelMeshItem[] };
  markVoxelTileStale: (key: string) => number;
  getVoxelRefreshVersion: (key: string) => number;
  cancelVoxelWork?: (key: string, olderThanVersion: number) => void;
  evictWarmCachedVoxelTile: (key: string) => void;
  requestDirectVoxelRefresh: (
    lod: number,
    regionX: number,
    regionY: number,
    version: number,
  ) => void;
  checkAndUpdateLOD: (
    camera: THREE.PerspectiveCamera,
    controls: OrbitControls,
  ) => void;
  debugLabelsDirtyRef: { current: boolean };
  biomeLabelsDirtyRef: { current: boolean };
}): void {
  const {
    regions,
    scene,
    loadedVoxels,
    availableVoxelKeys,
    missingVoxels,
    failedVoxels,
    loadingVoxels,
    voxelFetchControllers,
    pendingVoxelFetchQueueRef,
    pendingVoxelMeshQueueRef,
    markVoxelTileStale,
    getVoxelRefreshVersion,
    cancelVoxelWork,
    evictWarmCachedVoxelTile,
    requestDirectVoxelRefresh,
    checkAndUpdateLOD,
    debugLabelsDirtyRef,
    biomeLabelsDirtyRef,
  } = args;

  const supportedRegions = regions.filter(
    (region): region is VoxelInvalidationRegion =>
      isSupportedVoxelLod(region.lod),
  );
  const affectedRegions = expandVoxelInvalidationBatch(supportedRegions);
  for (const region of affectedRegions) {
    const key = voxelTileKey(region.lod, region.regionX, region.regionY);
    const version = markVoxelTileStale(key);
    cancelVoxelWork?.(key, version);
    missingVoxels.delete(key);
    failedVoxels.delete(key);
    evictWarmCachedVoxelTile(key);
    voxelFetchControllers.get(key)?.abort();
    pendingVoxelFetchQueueRef.current =
      pendingVoxelFetchQueueRef.current.filter((item) => item.key !== key);
    pendingVoxelMeshQueueRef.current = pendingVoxelMeshQueueRef.current.filter(
      (item) => item.key !== key || item.version >= getVoxelRefreshVersion(key),
    );
    loadingVoxels.delete(key);
    if (loadedVoxels.has(key) || availableVoxelKeys.has(key)) {
      requestDirectVoxelRefresh(
        region.lod,
        region.regionX,
        region.regionY,
        version,
      );
    }
  }
  if (scene) {
    checkAndUpdateLOD(scene.camera, scene.controls);
  }
  debugLabelsDirtyRef.current = true;
  biomeLabelsDirtyRef.current = true;
}
