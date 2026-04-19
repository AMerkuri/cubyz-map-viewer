import type { ChunkIndexEntry } from "../hooks/useWorldData.js";

import { LOD_LEVELS } from "./constants.js";
import { regionWorldSize } from "./utils.js";

export function voxelTileKey(
  lod: number,
  regionX: number,
  regionY: number,
): string {
  return `${lod}/${regionX}/${regionY}`;
}

export function voxelTileKeyAtWorld(
  lod: number,
  worldXPos: number,
  worldYPos: number,
): string {
  const size = regionWorldSize(lod);
  const regionX = Math.floor(worldXPos / size) * size;
  const regionY = Math.floor(worldYPos / size) * size;
  return voxelTileKey(lod, regionX, regionY);
}

export function getVoxelParentRegion(
  lod: number,
  regionX: number,
  regionY: number,
): ChunkIndexEntry | null {
  const parentLod = lod * 2;
  if (!LOD_LEVELS.includes(parentLod)) return null;

  const parentSize = regionWorldSize(parentLod);
  return {
    lod: parentLod,
    regionX: Math.floor(regionX / parentSize) * parentSize,
    regionY: Math.floor(regionY / parentSize) * parentSize,
  };
}

export function getImmediateFinerVoxelChildren(
  lod: number,
  regionX: number,
  regionY: number,
): ChunkIndexEntry[] {
  if (lod <= 1) return [];

  const childLod = lod / 2;
  const childSize = regionWorldSize(childLod);
  return [
    { lod: childLod, regionX, regionY },
    { lod: childLod, regionX: regionX + childSize, regionY },
    { lod: childLod, regionX, regionY: regionY + childSize },
    {
      lod: childLod,
      regionX: regionX + childSize,
      regionY: regionY + childSize,
    },
  ];
}

export function rebuildVoxelIndex(entries: ChunkIndexEntry[]): {
  availableKeys: Set<string>;
  roots: ChunkIndexEntry[];
} {
  const availableKeys = new Set<string>();
  for (const entry of entries) {
    const key = voxelTileKey(entry.lod, entry.regionX, entry.regionY);
    availableKeys.add(key);
  }

  const roots: ChunkIndexEntry[] = [];
  for (const entry of entries) {
    const parent = getVoxelParentRegion(
      entry.lod,
      entry.regionX,
      entry.regionY,
    );
    if (
      !parent ||
      !availableKeys.has(
        voxelTileKey(parent.lod, parent.regionX, parent.regionY),
      )
    ) {
      roots.push(entry);
    }
  }

  roots.sort(
    (a, b) => b.lod - a.lod || a.regionX - b.regionX || a.regionY - b.regionY,
  );
  return { availableKeys, roots };
}
