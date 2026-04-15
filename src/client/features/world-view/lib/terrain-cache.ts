import type * as THREE from "three";

import { estimateLoadedTerrainTileBytes } from "./memory.js";
import { buildSurfaceTileBorderLines } from "./terrain-builders.js";
import type { LoadedTerrainTile, WarmCachedTerrainTile } from "./types.js";

const MB = 1024 * 1024;
export const DEFAULT_WARM_TERRAIN_CACHE_MAX_BYTES = 256 * MB;

export function attachTerrainTileToScene(
  tile: LoadedTerrainTile,
  terrainGroup: THREE.Group | null,
  chunkBorderGroup: THREE.Group | null,
  showChunkBorders: boolean,
): void {
  tile.mesh.visible = false;
  terrainGroup?.add(tile.mesh);

  ensureTerrainBorderAssets(tile, chunkBorderGroup, showChunkBorders);
  if (tile.borderLines) {
    tile.borderLines.visible = showChunkBorders;
  }
  if (tile.borderLabel) {
    tile.borderLabel.visible = showChunkBorders;
  }
}

export function detachTerrainTileFromScene(
  tile: LoadedTerrainTile,
  terrainGroup: THREE.Group | null,
  chunkBorderGroup: THREE.Group | null,
): void {
  terrainGroup?.remove(tile.mesh);
  tile.mesh.visible = false;

  if (tile.borderLines) {
    chunkBorderGroup?.remove(tile.borderLines);
    tile.borderLines.visible = false;
  }
  if (tile.borderLabel) {
    chunkBorderGroup?.remove(tile.borderLabel);
    tile.borderLabel.visible = false;
  }
}

export function ensureTerrainBorderAssets(
  tile: LoadedTerrainTile,
  chunkBorderGroup: THREE.Group | null,
  showChunkBorders: boolean,
): void {
  if (tile.borderLines && tile.borderLabel) {
    tile.borderLines.visible = showChunkBorders;
    tile.borderLabel.visible = showChunkBorders;
    if (
      chunkBorderGroup &&
      !chunkBorderGroup.children.includes(tile.borderLines)
    ) {
      chunkBorderGroup.add(tile.borderLines);
    }
    if (
      chunkBorderGroup &&
      !chunkBorderGroup.children.includes(tile.borderLabel)
    ) {
      chunkBorderGroup.add(tile.borderLabel);
    }
    return;
  }

  const { lines, label } = buildSurfaceTileBorderLines(
    tile.worldX,
    tile.worldY,
    tile.lod,
    tile.mesh,
  );
  lines.visible = showChunkBorders;
  label.visible = showChunkBorders;
  tile.borderLines = lines;
  tile.borderLabel = label;
  chunkBorderGroup?.add(lines);
  chunkBorderGroup?.add(label);
}

export function disposeTerrainTileResources(
  tile: LoadedTerrainTile,
  terrainGroup: THREE.Group | null,
  chunkBorderGroup: THREE.Group | null,
  disposeTextSprite: (sprite: THREE.Sprite) => void,
): void {
  detachTerrainTileFromScene(tile, terrainGroup, chunkBorderGroup);
  tile.mesh.geometry.dispose();
  if (tile.borderLines) {
    tile.borderLines.geometry.dispose();
    (tile.borderLines.material as THREE.Material).dispose();
    tile.borderLines = null;
  }
  if (tile.borderLabel) {
    disposeTextSprite(tile.borderLabel);
    tile.borderLabel = null;
  }
}

export function evictWarmCachedTerrainTile(
  key: string,
  warmCachedTerrain: Map<string, WarmCachedTerrainTile>,
  warmCachedTerrainBytesRef: { current: number },
  terrainGroup: THREE.Group | null,
  chunkBorderGroup: THREE.Group | null,
  disposeTextSprite: (sprite: THREE.Sprite) => void,
): void {
  const cached = warmCachedTerrain.get(key);
  if (!cached) return;
  warmCachedTerrain.delete(key);
  warmCachedTerrainBytesRef.current = Math.max(
    0,
    warmCachedTerrainBytesRef.current - cached.bytes,
  );
  disposeTerrainTileResources(
    cached.tile,
    terrainGroup,
    chunkBorderGroup,
    disposeTextSprite,
  );
}

export function trimWarmTerrainCache(
  warmCachedTerrain: Map<string, WarmCachedTerrainTile>,
  warmCachedTerrainBytesRef: { current: number },
  maxBytes: number,
  terrainGroup: THREE.Group | null,
  chunkBorderGroup: THREE.Group | null,
  disposeTextSprite: (sprite: THREE.Sprite) => void,
): void {
  while (warmCachedTerrainBytesRef.current > maxBytes) {
    const oldest = warmCachedTerrain.keys().next().value;
    if (!oldest) break;
    evictWarmCachedTerrainTile(
      oldest,
      warmCachedTerrain,
      warmCachedTerrainBytesRef,
      terrainGroup,
      chunkBorderGroup,
      disposeTextSprite,
    );
  }
}

export function moveTerrainTileToWarmCache(args: {
  tile: LoadedTerrainTile;
  warmCachedTerrain: Map<string, WarmCachedTerrainTile>;
  warmCachedTerrainBytesRef: { current: number };
  warmTerrainCacheMaxBytes: number;
  terrainGroup: THREE.Group | null;
  chunkBorderGroup: THREE.Group | null;
  disposeTextSprite: (sprite: THREE.Sprite) => void;
}): void {
  const {
    tile,
    warmCachedTerrain,
    warmCachedTerrainBytesRef,
    warmTerrainCacheMaxBytes,
    terrainGroup,
    chunkBorderGroup,
    disposeTextSprite,
  } = args;
  const bytes = estimateLoadedTerrainTileBytes(tile);
  detachTerrainTileFromScene(tile, terrainGroup, chunkBorderGroup);

  const existing = warmCachedTerrain.get(tile.key);
  if (existing) {
    warmCachedTerrainBytesRef.current = Math.max(
      0,
      warmCachedTerrainBytesRef.current - existing.bytes,
    );
    disposeTerrainTileResources(
      existing.tile,
      terrainGroup,
      chunkBorderGroup,
      disposeTextSprite,
    );
    warmCachedTerrain.delete(tile.key);
  }

  warmCachedTerrain.set(tile.key, { tile, bytes });
  warmCachedTerrainBytesRef.current += bytes;
  trimWarmTerrainCache(
    warmCachedTerrain,
    warmCachedTerrainBytesRef,
    warmTerrainCacheMaxBytes,
    terrainGroup,
    chunkBorderGroup,
    disposeTextSprite,
  );
}

export function restoreTerrainTileFromWarmCache(args: {
  key: string;
  warmCachedTerrain: Map<string, WarmCachedTerrainTile>;
  warmCachedTerrainBytesRef: { current: number };
  terrainGroup: THREE.Group | null;
  chunkBorderGroup: THREE.Group | null;
  showChunkBorders: boolean;
}): LoadedTerrainTile | null {
  const {
    key,
    warmCachedTerrain,
    warmCachedTerrainBytesRef,
    terrainGroup,
    chunkBorderGroup,
    showChunkBorders,
  } = args;
  const cached = warmCachedTerrain.get(key);
  if (!cached) return null;

  warmCachedTerrain.delete(key);
  warmCachedTerrainBytesRef.current = Math.max(
    0,
    warmCachedTerrainBytesRef.current - cached.bytes,
  );
  attachTerrainTileToScene(
    cached.tile,
    terrainGroup,
    chunkBorderGroup,
    showChunkBorders,
  );
  return cached.tile;
}
