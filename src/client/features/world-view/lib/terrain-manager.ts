import type { QueryClient } from "@tanstack/react-query";
import type * as THREE from "three";
import type { SurfaceIndexEntry } from "../hooks/useWorldData.js";

import {
  TERRAIN_LOD_DISTANCE_THRESHOLDS,
  TERRAIN_UNDERLAY_OFFSET_Z,
} from "./constants.js";
import { getLodForDistance } from "./lod-utils.js";
import {
  buildFullTileMesh,
  buildSurfaceTileBorderLines,
} from "./terrain-builders.js";
import type { LoadedTerrainTile, TerrainMeshData } from "./types.js";
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

export async function loadTerrainTile(args: {
  lod: number;
  tileX: number;
  tileY: number;
  queryClient: QueryClient;
  loadingTerrain: Set<string>;
  loadedTerrain: Map<string, LoadedTerrainTile>;
  terrainGroup: THREE.Group | null;
  chunkBorderGroup: THREE.Group | null;
  terrainMaterial: THREE.Material;
  terrainVisibilityDirtyRef: { current: boolean };
  biomeLabelsDirtyRef: { current: boolean };
  debugLabelsDirtyRef: { current: boolean };
  showChunkBorders: boolean;
}): Promise<void> {
  const {
    lod,
    tileX,
    tileY,
    queryClient,
    loadingTerrain,
    loadedTerrain,
    terrainGroup,
    chunkBorderGroup,
    terrainMaterial,
    terrainVisibilityDirtyRef,
    biomeLabelsDirtyRef,
    debugLabelsDirtyRef,
    showChunkBorders,
  } = args;
  const key = terrainTileKey(lod, tileX, tileY);
  if (loadingTerrain.has(key) || loadedTerrain.has(key)) return;
  loadingTerrain.add(key);
  try {
    const meshData = await queryClient.fetchQuery<TerrainMeshData>({
      queryKey: ["terrain", lod, tileX, tileY],
      queryFn: async () => {
        const res = await fetch(`/api/terrain/${lod}/${tileX}/${tileY}`);
        if (!res.ok) throw new Error(`Terrain fetch failed (${res.status})`);
        return res.json() as Promise<TerrainMeshData>;
      },
      staleTime: Infinity,
    });
    if (loadedTerrain.has(key)) return;

    const mesh = buildFullTileMesh(meshData, terrainMaterial);
    mesh.visible = false;
    const { lines, label } = buildSurfaceTileBorderLines(
      meshData.worldX,
      meshData.worldY,
      lod,
      mesh,
    );
    lines.visible = showChunkBorders;
    label.visible = showChunkBorders;

    terrainGroup?.add(mesh);
    chunkBorderGroup?.add(lines);
    chunkBorderGroup?.add(label);
    loadedTerrain.set(key, {
      key,
      lod,
      tileX,
      tileY,
      worldX: meshData.worldX,
      worldY: meshData.worldY,
      mesh,
      borderLines: lines,
      borderLabel: label,
    });
    terrainVisibilityDirtyRef.current = true;
    biomeLabelsDirtyRef.current = true;
    debugLabelsDirtyRef.current = true;
  } finally {
    loadingTerrain.delete(key);
  }
}

export function updateTerrainVisibility(args: {
  target: THREE.Vector3;
  camDist: number;
  mode: "terrain" | "voxel";
  showTerrain: boolean;
  showVoxelTerrain: boolean;
  loadedTerrain: Map<string, LoadedTerrainTile>;
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
    const xyDist = Math.hypot(centerX - target.x, -centerY - target.y);
    const dist = Math.max(xyDist, camDist);
    const desiredLod = getLodForDistance(dist, TERRAIN_LOD_DISTANCE_THRESHOLDS);
    const visible = renderTerrain && tile.lod === desiredLod;
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

export async function syncTerrainLod(args: {
  target: THREE.Vector3;
  camDist: number;
  surfaceIndex: SurfaceIndexEntry[];
  loadedTerrain: Map<string, LoadedTerrainTile>;
  loadingTerrain: Set<string>;
  loadTerrainTile: (lod: number, tileX: number, tileY: number) => void;
  disposeTerrainTile: (tile: LoadedTerrainTile) => void;
  updateTerrainVisibility: (target: THREE.Vector3, camDist: number) => void;
  debugLabelsDirtyRef: { current: boolean };
  biomeLabelsDirtyRef: { current: boolean };
  terrainVisibilityDirtyRef: { current: boolean };
}): void {
  const {
    target,
    camDist,
    surfaceIndex,
    loadedTerrain,
    loadingTerrain,
    loadTerrainTile,
    disposeTerrainTile,
    updateTerrainVisibility,
    debugLabelsDirtyRef,
    biomeLabelsDirtyRef,
    terrainVisibilityDirtyRef,
  } = args;

  if (surfaceIndex.length > 0) {
    for (const entry of surfaceIndex) {
      const tileWorldSize = 256 * entry.lod;
      const centerX = entry.worldX + tileWorldSize / 2;
      const centerY = -(entry.worldY + tileWorldSize / 2);
      const xyDist = Math.hypot(centerX - target.x, centerY - target.y);
      const dist = Math.max(xyDist, camDist);
      const desiredLod = getLodForDistance(
        dist,
        TERRAIN_LOD_DISTANCE_THRESHOLDS,
      );
      if (entry.lod !== desiredLod) continue;
      const key = terrainTileKey(entry.lod, entry.tileX, entry.tileY);
      if (loadedTerrain.has(key) || loadingTerrain.has(key)) continue;
      loadTerrainTile(entry.lod, entry.tileX, entry.tileY);
    }
  }

  for (const [key, tile] of loadedTerrain) {
    const tileWorldSize = 256 * tile.lod;
    const centerWorldX = tile.worldX + tileWorldSize / 2;
    const centerWorldY = tile.worldY + tileWorldSize / 2;
    const centerSceneY = -centerWorldY;
    const xyDist = Math.hypot(centerWorldX - target.x, centerSceneY - target.y);
    const dist = Math.max(xyDist, camDist);
    const desiredLod = getLodForDistance(dist, TERRAIN_LOD_DISTANCE_THRESHOLDS);

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
