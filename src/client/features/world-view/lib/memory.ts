import type * as THREE from "three";

import type { LoadedVoxelTile } from "./types.js";

export function estimateGeometryBytes(geometry: THREE.BufferGeometry): number {
  let total = 0;

  for (const attr of Object.values(geometry.attributes)) {
    total += attr.array.byteLength;
  }

  if (geometry.index) {
    total += geometry.index.array.byteLength;
  }

  return total;
}

export function estimateLoadedVoxelTileBytes(tile: LoadedVoxelTile): number {
  let total =
    tile.chunkTopHeights.byteLength +
    estimateGeometryBytes(tile.borderLines.geometry);
  for (const sm of tile.subMeshes) {
    total += estimateGeometryBytes(sm.mesh.geometry);
    total += sm.baseColors.byteLength + sm.faceAo.byteLength;
  }
  return total;
}

export function addMemoryToLod(
  target: Partial<Record<1 | 2 | 4 | 8 | 16 | 32, number>>,
  lod: 1 | 2 | 4 | 8 | 16 | 32,
  bytes: number,
) {
  target[lod] = (target[lod] ?? 0) + bytes;
}
