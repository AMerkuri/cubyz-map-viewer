import type { QueryClient } from "@tanstack/react-query";
import type * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { terrainTileKey } from "./terrain-manager.js";
import type {
  LoadedTerrainTile,
  LoadedVoxelTile,
  PendingVoxelFetchRequest,
  PendingVoxelMeshItem,
} from "./types.js";
import { shouldRenderTerrainForMode } from "./utils.js";
import { voxelTileKey } from "./voxel-index.js";

export function handleTerrainTileUpdate(args: {
  lod: number;
  tileX: number;
  tileY: number;
  queryClient: QueryClient;
  mode: "terrain" | "voxel";
  showTerrain: boolean;
  showVoxelTerrain: boolean;
  loadedTerrain: Map<string, LoadedTerrainTile>;
  loadTerrainTile: (
    lod: number,
    tileX: number,
    tileY: number,
    options?: { replaceExisting?: boolean },
  ) => Promise<void> | void;
  disposeTerrainTile: (tile: LoadedTerrainTile) => void;
  debugLabelsDirtyRef: { current: boolean };
  biomeLabelsDirtyRef: { current: boolean };
}): void {
  const {
    lod,
    tileX,
    tileY,
    queryClient,
    mode,
    showTerrain,
    showVoxelTerrain,
    loadedTerrain,
    loadTerrainTile,
    disposeTerrainTile,
    debugLabelsDirtyRef,
    biomeLabelsDirtyRef,
  } = args;

  queryClient.invalidateQueries({ queryKey: ["terrain", lod, tileX, tileY] });
  queryClient.invalidateQueries({ queryKey: ["biomes", lod, tileX, tileY] });

  const key = terrainTileKey(lod, tileX, tileY);
  const existing = loadedTerrain.get(key);
  const shouldRenderTerrain = shouldRenderTerrainForMode(
    mode,
    showTerrain,
    showVoxelTerrain,
  );
  if (existing) {
    if (shouldRenderTerrain) {
      void loadTerrainTile(lod, tileX, tileY, { replaceExisting: true });
    } else {
      disposeTerrainTile(existing);
      loadedTerrain.delete(key);
      debugLabelsDirtyRef.current = true;
      biomeLabelsDirtyRef.current = true;
    }
  } else if (shouldRenderTerrain) {
    void loadTerrainTile(lod, tileX, tileY);
  }
}

export function handleVoxelRegionUpdate(args: {
  lod: number;
  regionX: number;
  regionY: number;
  mode: "terrain" | "voxel";
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
}): void {
  const {
    lod,
    regionX,
    regionY,
    mode,
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
    evictWarmCachedVoxelTile,
    requestDirectVoxelRefresh,
    checkAndUpdateLOD,
    debugLabelsDirtyRef,
  } = args;

  const key = voxelTileKey(lod, regionX, regionY);
  const version = markVoxelTileStale(key);
  missingVoxels.delete(key);
  failedVoxels.delete(key);
  evictWarmCachedVoxelTile(key);
  voxelFetchControllers.get(key)?.abort();
  pendingVoxelFetchQueueRef.current = pendingVoxelFetchQueueRef.current.filter(
    (item) => item.key !== key,
  );
  pendingVoxelMeshQueueRef.current = pendingVoxelMeshQueueRef.current.filter(
    (item) => item.key !== key || item.version >= getVoxelRefreshVersion(key),
  );
  loadingVoxels.delete(key);
  if (mode === "voxel" && scene) {
    checkAndUpdateLOD(scene.camera, scene.controls);
  }
  if (loadedVoxels.has(key) || availableVoxelKeys.has(key)) {
    requestDirectVoxelRefresh(lod, regionX, regionY, version);
  }
  debugLabelsDirtyRef.current = true;
}
