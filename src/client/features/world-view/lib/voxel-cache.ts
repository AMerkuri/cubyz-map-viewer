import type * as THREE from "three";

import { estimateLoadedVoxelTileMemory } from "./memory.js";
import type { LoadedVoxelTile, WarmCachedVoxelTile } from "./types.js";

function detachVoxelTileFromScene(
  tile: LoadedVoxelTile,
  voxelGroup: THREE.Group | null,
  chunkBorderGroup: THREE.Group | null,
): void {
  for (const sm of [...tile.subMeshes, ...tile.transparentSubMeshes]) {
    voxelGroup?.remove(sm.mesh);
    sm.mesh.visible = false;
  }
  chunkBorderGroup?.remove(tile.borderLines);
  tile.borderLines.visible = false;
}

function attachVoxelTileToScene(
  tile: LoadedVoxelTile,
  voxelGroup: THREE.Group | null,
  chunkBorderGroup: THREE.Group | null,
): void {
  for (const sm of [...tile.subMeshes, ...tile.transparentSubMeshes]) {
    sm.mesh.visible = false;
    voxelGroup?.add(sm.mesh);
  }
  tile.borderLines.visible = false;
  chunkBorderGroup?.add(tile.borderLines);
}

export function disposeVoxelTileResources(
  tile: LoadedVoxelTile,
  voxelGroup: THREE.Group | null,
  chunkBorderGroup: THREE.Group | null,
): void {
  detachVoxelTileFromScene(tile, voxelGroup, chunkBorderGroup);
  for (const sm of [...tile.subMeshes, ...tile.transparentSubMeshes]) {
    sm.mesh.geometry.dispose();
  }
  tile.borderLines.geometry.dispose();
  (tile.borderLines.material as THREE.Material).dispose();
}

export function evictWarmCachedVoxelTile(
  key: string,
  warmCachedVoxels: Map<string, WarmCachedVoxelTile>,
  warmCachedVoxelBytesRef: { current: number },
  voxelGroup: THREE.Group | null,
  chunkBorderGroup: THREE.Group | null,
): void {
  const cached = warmCachedVoxels.get(key);
  if (!cached) return;
  warmCachedVoxels.delete(key);
  warmCachedVoxelBytesRef.current = Math.max(
    0,
    warmCachedVoxelBytesRef.current - cached.bytes,
  );
  disposeVoxelTileResources(cached.tile, voxelGroup, chunkBorderGroup);
}

function trimWarmVoxelCache(
  warmCachedVoxels: Map<string, WarmCachedVoxelTile>,
  warmCachedVoxelBytesRef: { current: number },
  maxBytes: number,
  voxelGroup: THREE.Group | null,
  chunkBorderGroup: THREE.Group | null,
): void {
  while (warmCachedVoxelBytesRef.current > maxBytes) {
    const oldest = warmCachedVoxels.keys().next().value;
    if (!oldest) break;
    evictWarmCachedVoxelTile(
      oldest,
      warmCachedVoxels,
      warmCachedVoxelBytesRef,
      voxelGroup,
      chunkBorderGroup,
    );
  }
}

export function moveVoxelTileToWarmCache(args: {
  tile: LoadedVoxelTile;
  warmCachedVoxels: Map<string, WarmCachedVoxelTile>;
  warmCachedVoxelBytesRef: { current: number };
  warmVoxelCacheMaxBytes: number;
  voxelGroup: THREE.Group | null;
  chunkBorderGroup: THREE.Group | null;
}): void {
  const {
    tile,
    warmCachedVoxels,
    warmCachedVoxelBytesRef,
    warmVoxelCacheMaxBytes,
    voxelGroup,
    chunkBorderGroup,
  } = args;
  const bytes = estimateLoadedVoxelTileMemory(tile).totalBytes;
  detachVoxelTileFromScene(tile, voxelGroup, chunkBorderGroup);

  const existing = warmCachedVoxels.get(tile.key);
  if (existing) {
    warmCachedVoxelBytesRef.current = Math.max(
      0,
      warmCachedVoxelBytesRef.current - existing.bytes,
    );
    disposeVoxelTileResources(existing.tile, voxelGroup, chunkBorderGroup);
    warmCachedVoxels.delete(tile.key);
  }

  warmCachedVoxels.set(tile.key, { tile, bytes });
  warmCachedVoxelBytesRef.current += bytes;
  trimWarmVoxelCache(
    warmCachedVoxels,
    warmCachedVoxelBytesRef,
    warmVoxelCacheMaxBytes,
    voxelGroup,
    chunkBorderGroup,
  );
}

export function restoreVoxelTileFromWarmCache(args: {
  key: string;
  warmCachedVoxels: Map<string, WarmCachedVoxelTile>;
  warmCachedVoxelBytesRef: { current: number };
  voxelGroup: THREE.Group | null;
  chunkBorderGroup: THREE.Group | null;
  isVoxelTileStale: (key: string) => boolean;
}): LoadedVoxelTile | null {
  const {
    key,
    warmCachedVoxels,
    warmCachedVoxelBytesRef,
    voxelGroup,
    chunkBorderGroup,
    isVoxelTileStale,
  } = args;
  if (isVoxelTileStale(key)) return null;
  const cached = warmCachedVoxels.get(key);
  if (!cached) return null;

  warmCachedVoxels.delete(key);
  warmCachedVoxelBytesRef.current = Math.max(
    0,
    warmCachedVoxelBytesRef.current - cached.bytes,
  );
  attachVoxelTileToScene(cached.tile, voxelGroup, chunkBorderGroup);
  return cached.tile;
}
