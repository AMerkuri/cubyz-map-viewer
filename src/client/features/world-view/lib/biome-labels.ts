import type { QueryClient } from "@tanstack/react-query";
import type * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import type { SurfaceIndexEntry } from "../hooks/useWorldData.js";

import {
  MAX_BIOME_LABELS,
  TERRAIN_LOD_DISTANCE_THRESHOLDS,
} from "./constants.js";
import { clearCssLabelMap } from "./debug-overlays.js";
import { getLodForDistance } from "./lod-utils.js";
import { terrainTileKey } from "./terrain-manager.js";
import type {
  BiomesResponse,
  LoadedTerrainTile,
  LoadedVoxelTile,
} from "./types.js";
import { formatBiomeName, regionWorldSize } from "./utils.js";

export async function fetchBiomes(
  queryClient: QueryClient,
  lod: number,
  tileX: number,
  tileY: number,
): Promise<BiomesResponse | null> {
  const url = `/api/biomes/${lod}/${tileX}/${tileY}`;
  try {
    return await queryClient.fetchQuery<BiomesResponse | null>({
      queryKey: ["biomes", lod, tileX, tileY],
      queryFn: async () => {
        const res = await fetch(url);
        if (!res.ok) return null;
        return res.json() as Promise<BiomesResponse>;
      },
    });
  } catch {
    return null;
  }
}

export async function refreshBiomeLabels(args: {
  target: THREE.Vector3;
  camDist: number;
  mode: "terrain" | "voxel";
  showBiomeLabels: boolean;
  group: THREE.Group | null;
  labelMap: Map<string, CSS2DObject>;
  queryClient: QueryClient;
  surfaceIndex: SurfaceIndexEntry[];
  loadedTerrain: Iterable<LoadedTerrainTile>;
  loadedVoxels: Iterable<LoadedVoxelTile>;
  token: number;
  getCurrentToken: () => number;
}): Promise<void> {
  const {
    target,
    camDist,
    mode,
    showBiomeLabels,
    group,
    labelMap,
    queryClient,
    surfaceIndex,
    loadedTerrain,
    loadedVoxels,
    token,
    getCurrentToken,
  } = args;

  if (!showBiomeLabels) {
    clearCssLabelMap(group, labelMap);
    return;
  }
  if (!group) return;

  const visibleTiles: {
    key: string;
    lod: number;
    tileX: number;
    tileY: number;
    z: number;
  }[] = [];

  if (mode === "terrain") {
    for (const tile of loadedTerrain) {
      if (!tile.mesh.visible) continue;
      visibleTiles.push({
        key: tile.key,
        lod: tile.lod,
        tileX: tile.tileX,
        tileY: tile.tileY,
        z: (tile.mesh.geometry.boundingBox?.max.z ?? 0) + 10,
      });
    }
    visibleTiles.sort((a, b) => {
      const aWorldX = a.tileX * 256 * a.lod + (256 * a.lod) / 2;
      const aWorldY = a.tileY * 256 * a.lod + (256 * a.lod) / 2;
      const bWorldX = b.tileX * 256 * b.lod + (256 * b.lod) / 2;
      const bWorldY = b.tileY * 256 * b.lod + (256 * b.lod) / 2;
      const ad = Math.hypot(aWorldX - target.x, -aWorldY - target.y);
      const bd = Math.hypot(bWorldX - target.x, -bWorldY - target.y);
      return ad - bd;
    });
  } else {
    const indexedTiles = surfaceIndex
      .map((entry) => {
        const tileWorldSize = 256 * entry.lod;
        const centerX = entry.worldX + tileWorldSize / 2;
        const centerY = entry.worldY + tileWorldSize / 2;
        const xyDist = Math.hypot(centerX - target.x, -centerY - target.y);
        const dist = Math.max(xyDist, camDist);
        return {
          entry,
          dist,
          desiredLod: getLodForDistance(dist, TERRAIN_LOD_DISTANCE_THRESHOLDS),
        };
      })
      .filter((item) => item.entry.lod === item.desiredLod)
      .sort((a, b) => a.dist - b.dist);

    const voxelTiles = [...loadedVoxels];
    for (const item of indexedTiles) {
      const tileSize = 256 * item.entry.lod;
      const tileCenterX = item.entry.worldX + tileSize / 2;
      const tileCenterY = item.entry.worldY + tileSize / 2;
      let labelZ = target.z + 12;
      for (const voxelTile of voxelTiles) {
        const regionSize = regionWorldSize(voxelTile.lod);
        if (
          tileCenterX >= voxelTile.regionX &&
          tileCenterX < voxelTile.regionX + regionSize &&
          tileCenterY >= voxelTile.regionY &&
          tileCenterY < voxelTile.regionY + regionSize
        ) {
          labelZ = Math.max(labelZ, voxelTile.maxZ + 10);
        }
      }
      visibleTiles.push({
        key: terrainTileKey(item.entry.lod, item.entry.tileX, item.entry.tileY),
        lod: item.entry.lod,
        tileX: item.entry.tileX,
        tileY: item.entry.tileY,
        z: labelZ,
      });
    }
  }

  if (visibleTiles.length === 0) {
    clearCssLabelMap(group, labelMap);
    return;
  }

  const fetched = await Promise.all(
    visibleTiles.map(async (tile) => ({
      tile,
      data: await fetchBiomes(queryClient, tile.lod, tile.tileX, tile.tileY),
    })),
  );

  if (token !== getCurrentToken()) return;

  const candidates: {
    key: string;
    text: string;
    x: number;
    y: number;
    z: number;
    score: number;
  }[] = [];

  for (const item of fetched) {
    if (!item.data) continue;
    let perTile = 0;
    for (const region of item.data.regions) {
      if (region.count < 256) continue;
      candidates.push({
        key: `${item.tile.key}#${region.centerX.toFixed(1)}#${region.centerY.toFixed(1)}`,
        text: formatBiomeName(region.biomeName),
        x: region.centerX,
        y: region.centerY,
        z: item.tile.z,
        score: region.count,
      });
      perTile++;
      if (perTile >= 4) break;
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const picked = candidates.slice(0, MAX_BIOME_LABELS);
  const active = new Set<string>();

  for (const labelData of picked) {
    active.add(labelData.key);

    let label = labelMap.get(labelData.key);
    if (!label) {
      const div = document.createElement("div");
      div.style.cssText =
        "color: rgba(255,255,255,0.78); font-size: 11px; font-weight: 600; text-shadow: 0 0 4px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.5); pointer-events: none; white-space: nowrap;";
      label = new CSS2DObject(div);
      group.add(label);
      labelMap.set(labelData.key, label);
    }

    const el = label.element as HTMLDivElement;
    el.textContent = labelData.text;
    label.position.set(labelData.x, -labelData.y, labelData.z);
  }

  for (const [key, label] of labelMap) {
    if (!active.has(key)) {
      group.remove(label);
      labelMap.delete(key);
    }
  }
}
