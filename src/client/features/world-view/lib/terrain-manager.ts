import type { QueryClient } from "@tanstack/react-query";
import type * as THREE from "three";
import type { SurfaceIndexEntry } from "../hooks/useWorldData.js";

import {
  TERRAIN_LOD_DISTANCE_THRESHOLDS,
  TERRAIN_UNDERLAY_OFFSET_Z,
} from "./constants.js";
import {
  getLodForDistance,
  getLodForDistanceWithHysteresis,
} from "./lod-utils.js";
import {
  buildFullTileMesh,
  buildSurfaceTileBorderLines,
} from "./terrain-builders.js";
import type {
  LoadedTerrainTile,
  PendingTerrainFetchRequest,
  PendingTerrainMeshItem,
  TerrainMeshData,
} from "./types.js";
import { regionWorldSize, shouldRenderTerrainForMode } from "./utils.js";

export function terrainTileKey(
  lod: number,
  tileX: number,
  tileY: number,
): string {
  return `${lod}/${tileX}/${tileY}`;
}

export function terrainTileKeyAtWorld(
  lod: number,
  worldXPos: number,
  worldYPos: number,
): string {
  const size = 256 * lod;
  const tileX = Math.floor(worldXPos / size);
  const tileY = Math.floor(worldYPos / size);
  return terrainTileKey(lod, tileX, tileY);
}

export function hasLoadedTerrainTileAtWorld(
  loadedTerrain: Map<string, LoadedTerrainTile>,
  lod: number,
  worldXPos: number,
  worldYPos: number,
): boolean {
  return loadedTerrain.has(terrainTileKeyAtWorld(lod, worldXPos, worldYPos));
}

export function hasAllImmediateFinerTerrainChildrenLoaded(
  loadedTerrain: Map<string, LoadedTerrainTile>,
  tile: LoadedTerrainTile,
): boolean {
  if (tile.lod <= 1) return false;
  const finerLod = tile.lod / 2;
  for (let ox = 0; ox <= 1; ox++) {
    for (let oy = 0; oy <= 1; oy++) {
      const childKey = terrainTileKey(
        finerLod,
        tile.tileX * 2 + ox,
        tile.tileY * 2 + oy,
      );
      if (!loadedTerrain.has(childKey)) return false;
    }
  }
  return true;
}

function compareTerrainFetchRequests(
  a: PendingTerrainFetchRequest,
  b: PendingTerrainFetchRequest,
): number {
  if (a.priority !== b.priority) {
    return a.priority - b.priority;
  }
  return b.generation - a.generation;
}

function getPendingTerrainParentKey(
  tile: LoadedTerrainTile,
  desiredLod: number,
  loadingTerrain: Set<string>,
): string | null {
  if (tile.lod >= desiredLod || desiredLod <= 0) {
    return null;
  }

  let currentLod = desiredLod;
  let currentTileX = Math.floor(tile.worldX / (256 * desiredLod));
  let currentTileY = Math.floor(tile.worldY / (256 * desiredLod));
  while (currentLod > tile.lod) {
    const key = terrainTileKey(currentLod, currentTileX, currentTileY);
    if (loadingTerrain.has(key)) {
      return key;
    }
    currentLod /= 2;
    currentTileX = Math.floor(currentTileX / 2);
    currentTileY = Math.floor(currentTileY / 2);
  }
  return null;
}

export function queueTerrainFetchRequest(
  queue: PendingTerrainFetchRequest[],
  request: PendingTerrainFetchRequest,
): void {
  const existingIndex = queue.findIndex((item) => item.key === request.key);
  if (existingIndex !== -1) {
    queue[existingIndex] = request;
  } else {
    queue.push(request);
  }
  queue.sort(compareTerrainFetchRequests);
}

export function disposeTerrainTile(
  tile: LoadedTerrainTile,
  terrainGroup: THREE.Group | null,
  chunkBorderGroup: THREE.Group | null,
  disposeTextSprite: (sprite: THREE.Sprite) => void,
): void {
  terrainGroup?.remove(tile.mesh);
  tile.mesh.geometry.dispose();
  chunkBorderGroup?.remove(tile.borderLines);
  tile.borderLines.geometry.dispose();
  (tile.borderLines.material as THREE.Material).dispose();
  chunkBorderGroup?.remove(tile.borderLabel);
  disposeTextSprite(tile.borderLabel);
}

export function clearTerrainTiles(
  loadedTerrain: Map<string, LoadedTerrainTile>,
  terrainGroup: THREE.Group | null,
  chunkBorderGroup: THREE.Group | null,
  disposeTextSprite: (sprite: THREE.Sprite) => void,
): void {
  for (const tile of loadedTerrain.values()) {
    disposeTerrainTile(tile, terrainGroup, chunkBorderGroup, disposeTextSprite);
  }
  loadedTerrain.clear();
}

export function finishTerrainFetch(args: {
  key: string;
  activeTerrainFetchCountRef: { current: number };
  terrainFetchControllersRef: { current: Map<string, AbortController> };
  drainTerrainFetchQueue: () => void;
}): void {
  const {
    key,
    activeTerrainFetchCountRef,
    terrainFetchControllersRef,
    drainTerrainFetchQueue,
  } = args;

  terrainFetchControllersRef.current.delete(key);
  activeTerrainFetchCountRef.current = Math.max(
    0,
    activeTerrainFetchCountRef.current - 1,
  );
  drainTerrainFetchQueue();
}

export function drainTerrainFetchQueue(args: {
  pendingTerrainFetchQueueRef: { current: PendingTerrainFetchRequest[] };
  activeTerrainFetchCountRef: { current: number };
  maxConcurrentTerrainFetches: number;
  activeTerrainRequestKeysRef: { current: Set<string> };
  loadedTerrainRef: { current: Map<string, LoadedTerrainTile> };
  loadingTerrainRef: { current: Set<string> };
  terrainFetchControllersRef: { current: Map<string, AbortController> };
  fetchTerrainTile: (
    request: PendingTerrainFetchRequest,
    controller: AbortController,
  ) => void;
}): void {
  const {
    pendingTerrainFetchQueueRef,
    activeTerrainFetchCountRef,
    maxConcurrentTerrainFetches,
    activeTerrainRequestKeysRef,
    loadedTerrainRef,
    loadingTerrainRef,
    terrainFetchControllersRef,
    fetchTerrainTile,
  } = args;

  pendingTerrainFetchQueueRef.current.sort(compareTerrainFetchRequests);

  while (
    activeTerrainFetchCountRef.current < maxConcurrentTerrainFetches &&
    pendingTerrainFetchQueueRef.current.length > 0
  ) {
    const next = pendingTerrainFetchQueueRef.current.shift();
    if (!next) continue;
    if (!activeTerrainRequestKeysRef.current.has(next.key)) {
      loadingTerrainRef.current.delete(next.key);
      continue;
    }
    if (loadedTerrainRef.current.has(next.key)) {
      loadingTerrainRef.current.delete(next.key);
      continue;
    }
    if (terrainFetchControllersRef.current.has(next.key)) {
      continue;
    }
    if (!loadingTerrainRef.current.has(next.key)) {
      continue;
    }

    activeTerrainFetchCountRef.current++;
    const controller = new AbortController();
    terrainFetchControllersRef.current.set(next.key, controller);
    fetchTerrainTile(next, controller);
  }
}

export async function fetchTerrainTile(args: {
  request: PendingTerrainFetchRequest;
  controller: AbortController;
  queryClient: QueryClient;
  activeTerrainRequestKeysRef: { current: Set<string> };
  loadedTerrainRef: { current: Map<string, LoadedTerrainTile> };
  loadingTerrainRef: { current: Set<string> };
  pendingTerrainMeshQueueRef: { current: PendingTerrainMeshItem[] };
  onFinally: (key: string) => void;
}): Promise<void> {
  const {
    request,
    controller,
    queryClient,
    activeTerrainRequestKeysRef,
    loadedTerrainRef,
    loadingTerrainRef,
    pendingTerrainMeshQueueRef,
    onFinally,
  } = args;
  const { key, lod, tileX, tileY, generation } = request;

  try {
    const meshData = await queryClient.fetchQuery<TerrainMeshData>({
      queryKey: ["terrain", lod, tileX, tileY],
      queryFn: async () => {
        const res = await fetch(`/api/terrain/${lod}/${tileX}/${tileY}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Terrain fetch failed (${res.status})`);
        return res.json() as Promise<TerrainMeshData>;
      },
      staleTime: Infinity,
    });

    if (
      !activeTerrainRequestKeysRef.current.has(key) ||
      loadedTerrainRef.current.has(key)
    ) {
      loadingTerrainRef.current.delete(key);
      return;
    }

    pendingTerrainMeshQueueRef.current =
      pendingTerrainMeshQueueRef.current.filter((item) => item.key !== key);
    pendingTerrainMeshQueueRef.current.push({
      key,
      lod,
      tileX,
      tileY,
      generation,
      meshData,
    });
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError")) {
      loadingTerrainRef.current.delete(key);
    }
  } finally {
    onFinally(key);
  }
}

export function buildQueuedTerrainMeshes(args: {
  pendingTerrainMeshQueueRef: { current: PendingTerrainMeshItem[] };
  maxTerrainMeshesPerFrame: number;
  terrainMeshBuildBudgetMs: number;
  activeTerrainRequestKeysRef: { current: Set<string> };
  loadedTerrainRef: { current: Map<string, LoadedTerrainTile> };
  loadingTerrainRef: { current: Set<string> };
  terrainGroup: THREE.Group | null;
  chunkBorderGroup: THREE.Group | null;
  terrainMaterial: THREE.Material;
  showChunkBorders: boolean;
  debugLabelsDirtyRef: { current: boolean };
  biomeLabelsDirtyRef: { current: boolean };
  terrainVisibilityDirtyRef: { current: boolean };
}): boolean {
  const {
    pendingTerrainMeshQueueRef,
    maxTerrainMeshesPerFrame,
    terrainMeshBuildBudgetMs,
    activeTerrainRequestKeysRef,
    loadedTerrainRef,
    loadingTerrainRef,
    terrainGroup,
    chunkBorderGroup,
    terrainMaterial,
    showChunkBorders,
    debugLabelsDirtyRef,
    biomeLabelsDirtyRef,
    terrainVisibilityDirtyRef,
  } = args;

  let builtTerrainTile = false;
  if (pendingTerrainMeshQueueRef.current.length === 0) {
    return builtTerrainTile;
  }

  const buildStart = performance.now();
  let processed = 0;

  while (
    pendingTerrainMeshQueueRef.current.length > 0 &&
    processed < maxTerrainMeshesPerFrame &&
    performance.now() - buildStart < terrainMeshBuildBudgetMs
  ) {
    const item = pendingTerrainMeshQueueRef.current.shift();
    if (!item) continue;
    processed++;

    if (
      !activeTerrainRequestKeysRef.current.has(item.key) ||
      loadedTerrainRef.current.has(item.key)
    ) {
      loadingTerrainRef.current.delete(item.key);
      continue;
    }

    const mesh = buildFullTileMesh(item.meshData, terrainMaterial);
    mesh.visible = false;
    const { lines, label } = buildSurfaceTileBorderLines(
      item.meshData.worldX,
      item.meshData.worldY,
      item.lod,
      mesh,
    );
    lines.visible = showChunkBorders;
    label.visible = showChunkBorders;

    terrainGroup?.add(mesh);
    chunkBorderGroup?.add(lines);
    chunkBorderGroup?.add(label);
    loadedTerrainRef.current.set(item.key, {
      key: item.key,
      lod: item.lod,
      tileX: item.tileX,
      tileY: item.tileY,
      worldX: item.meshData.worldX,
      worldY: item.meshData.worldY,
      mesh,
      borderLines: lines,
      borderLabel: label,
    });
    loadingTerrainRef.current.delete(item.key);
    terrainVisibilityDirtyRef.current = true;
    biomeLabelsDirtyRef.current = true;
    debugLabelsDirtyRef.current = true;
    builtTerrainTile = true;
  }

  pendingTerrainMeshQueueRef.current =
    pendingTerrainMeshQueueRef.current.filter((item) =>
      activeTerrainRequestKeysRef.current.has(item.key),
    );

  return builtTerrainTile;
}

export function updateTerrainVisibility(args: {
  target: THREE.Vector3;
  camDist: number;
  mode: "terrain" | "voxel";
  showTerrain: boolean;
  showVoxelTerrain: boolean;
  loadedTerrain: Map<string, LoadedTerrainTile>;
  loadingTerrain: Set<string>;
  terrainLodHysteresisRatio: number;
  activeFocusLod: number;
  loadedVoxels: Iterable<{
    regionX: number;
    regionY: number;
    lod: number;
    minZ: number;
    maxZ: number;
  }>;
}): void {
  const {
    target,
    camDist,
    mode,
    showTerrain,
    showVoxelTerrain,
    loadedTerrain,
    loadingTerrain,
    terrainLodHysteresisRatio,
    activeFocusLod,
    loadedVoxels,
  } = args;
  const renderTerrain = shouldRenderTerrainForMode(
    mode,
    showTerrain,
    showVoxelTerrain,
  );

  for (const tile of loadedTerrain.values()) {
    const tileWorldSize = 256 * tile.lod;
    const centerX = tile.worldX + tileWorldSize / 2;
    const centerY = tile.worldY + tileWorldSize / 2;
    const xyDist = Math.hypot(centerX - target.x, centerY - target.y);
    const dist = Math.max(xyDist, camDist);
    const desiredLod = getLodForDistanceWithHysteresis(
      dist,
      activeFocusLod,
      TERRAIN_LOD_DISTANCE_THRESHOLDS,
      terrainLodHysteresisRatio,
    );
    const visibleByDistance = tile.lod === desiredLod;
    const keepCoarseFallback =
      tile.lod > desiredLod &&
      !hasAllImmediateFinerTerrainChildrenLoaded(loadedTerrain, tile);
    const keepFineFallback =
      tile.lod < desiredLod &&
      getPendingTerrainParentKey(tile, desiredLod, loadingTerrain) !== null;
    const visible =
      renderTerrain &&
      (visibleByDistance || keepCoarseFallback || keepFineFallback);
    tile.mesh.visible = visible;

    const underlay = mode === "voxel" && showVoxelTerrain;
    tile.mesh.position.z = underlay ? TERRAIN_UNDERLAY_OFFSET_Z : 0;

    if (underlay && visible) {
      let zCap = Number.NEGATIVE_INFINITY;
      for (const voxelTile of loadedVoxels) {
        const regionSize = regionWorldSize(voxelTile.lod);
        if (
          centerX >= voxelTile.regionX &&
          centerX < voxelTile.regionX + regionSize &&
          centerY >= voxelTile.regionY &&
          centerY < voxelTile.regionY + regionSize
        ) {
          zCap = Math.max(zCap, voxelTile.minZ, voxelTile.maxZ);
        }
      }
      if (Number.isFinite(zCap)) {
        tile.mesh.position.z = Math.min(
          TERRAIN_UNDERLAY_OFFSET_Z,
          zCap - (tile.mesh.geometry.boundingBox?.max.z ?? 0) - 4,
        );
      }
    }
  }
}

export function syncTerrainLod(args: {
  target: THREE.Vector3;
  camDist: number;
  surfaceIndex: SurfaceIndexEntry[];
  loadedTerrain: Map<string, LoadedTerrainTile>;
  loadingTerrain: Set<string>;
  queueTerrainTileLoad: (
    lod: number,
    tileX: number,
    tileY: number,
    priority: number,
  ) => void;
  disposeTerrainTile: (tile: LoadedTerrainTile) => void;
  updateTerrainVisibility: (target: THREE.Vector3, camDist: number) => void;
  debugLabelsDirtyRef: { current: boolean };
  biomeLabelsDirtyRef: { current: boolean };
  terrainVisibilityDirtyRef: { current: boolean };
  activeFocusLodRef: { current: number };
  terrainLodHysteresisRatio: number;
}): void {
  const {
    target,
    camDist,
    surfaceIndex,
    loadedTerrain,
    loadingTerrain,
    queueTerrainTileLoad,
    disposeTerrainTile,
    updateTerrainVisibility,
    debugLabelsDirtyRef,
    biomeLabelsDirtyRef,
    terrainVisibilityDirtyRef,
    activeFocusLodRef,
    terrainLodHysteresisRatio,
  } = args;

  const desiredCameraLod = getLodForDistanceWithHysteresis(
    camDist,
    activeFocusLodRef.current,
    TERRAIN_LOD_DISTANCE_THRESHOLDS,
    terrainLodHysteresisRatio,
  );
  activeFocusLodRef.current = desiredCameraLod;

  if (surfaceIndex.length > 0) {
    for (const entry of surfaceIndex) {
      const tileWorldSize = 256 * entry.lod;
      const centerX = entry.worldX + tileWorldSize / 2;
      const centerY = entry.worldY + tileWorldSize / 2;
      const xyDist = Math.hypot(centerX - target.x, centerY - target.y);
      const dist = Math.max(xyDist, camDist);
      const desiredLod = getLodForDistanceWithHysteresis(
        dist,
        desiredCameraLod,
        TERRAIN_LOD_DISTANCE_THRESHOLDS,
        terrainLodHysteresisRatio,
      );
      if (entry.lod !== desiredLod) continue;
      const key = terrainTileKey(entry.lod, entry.tileX, entry.tileY);
      if (loadedTerrain.has(key) || loadingTerrain.has(key)) continue;
      queueTerrainTileLoad(
        entry.lod,
        entry.tileX,
        entry.tileY,
        Math.round(dist),
      );
    }
  }

  for (const [key, tile] of loadedTerrain) {
    const tileWorldSize = 256 * tile.lod;
    const centerWorldX = tile.worldX + tileWorldSize / 2;
    const centerWorldY = tile.worldY + tileWorldSize / 2;
    const xyDist = Math.hypot(centerWorldX - target.x, centerWorldY - target.y);
    const dist = Math.max(xyDist, camDist);
    const desiredLod = getLodForDistanceWithHysteresis(
      dist,
      desiredCameraLod,
      TERRAIN_LOD_DISTANCE_THRESHOLDS,
      terrainLodHysteresisRatio,
    );

    let replacedByPriority = false;
    if (desiredLod > tile.lod) {
      replacedByPriority = hasLoadedTerrainTileAtWorld(
        loadedTerrain,
        desiredLod,
        centerWorldX,
        centerWorldY,
      );
    } else if (desiredLod < tile.lod) {
      replacedByPriority = hasAllImmediateFinerTerrainChildrenLoaded(
        loadedTerrain,
        tile,
      );
    }

    if (replacedByPriority) {
      disposeTerrainTile(tile);
      loadedTerrain.delete(key);
      biomeLabelsDirtyRef.current = true;
      debugLabelsDirtyRef.current = true;
    }
  }

  updateTerrainVisibility(target, camDist);
  terrainVisibilityDirtyRef.current = false;
}

export function getTerrainLodForDistance(
  dist: number,
  previousLod: number,
  terrainLodHysteresisRatio: number,
): number {
  return getLodForDistanceWithHysteresis(
    dist,
    previousLod,
    TERRAIN_LOD_DISTANCE_THRESHOLDS,
    terrainLodHysteresisRatio,
  );
}

export function getTerrainLodForDistanceWithoutHysteresis(
  dist: number,
): number {
  return getLodForDistance(dist, TERRAIN_LOD_DISTANCE_THRESHOLDS);
}
