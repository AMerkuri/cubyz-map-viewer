import type * as THREE from "three";

import type { LoadedTerrainTile, LoadedVoxelTile } from "./types.js";

const ESTIMATED_TEXT_SPRITE_BYTES = 256 * 64 * 4;

interface VoxelTileMemoryEstimate {
  geometryBytes: number;
  metadataBytes: number;
  totalBytes: number;
}

function estimateGeometryBytes(geometry: THREE.BufferGeometry): number {
  let total = 0;

  for (const attr of Object.values(geometry.attributes)) {
    total += attr.array.byteLength;
  }

  if (geometry.index) {
    total += geometry.index.array.byteLength;
  }

  return total;
}

export function estimateLoadedVoxelTileMemory(
  tile: LoadedVoxelTile,
): VoxelTileMemoryEstimate {
  let geometryBytes = estimateGeometryBytes(tile.borderLines.geometry);
  let metadataBytes = tile.chunkTopHeights.byteLength;
  metadataBytes += tile.emitterRecords.length * 32;
  for (const sm of [...tile.subMeshes, ...tile.transparentSubMeshes]) {
    const geometry = sm.mesh.geometry;
    geometryBytes += estimateGeometryBytes(geometry);
    const colorAttr = geometry.getAttribute("color");
    const retainedBaseColorBytes =
      colorAttr?.array === sm.baseColors ? 0 : sm.baseColors.byteLength;
    metadataBytes +=
      retainedBaseColorBytes +
      sm.faceAo.byteLength +
      sm.trianglePaletteIndices.byteLength;
  }
  return {
    geometryBytes,
    metadataBytes,
    totalBytes: geometryBytes + metadataBytes,
  };
}

export function estimateLoadedTerrainTileBytes(
  tile: LoadedTerrainTile,
): number {
  let total = estimateGeometryBytes(tile.mesh.geometry);
  if (tile.borderLines) {
    total += estimateGeometryBytes(tile.borderLines.geometry);
  }
  if (tile.borderLabel) {
    total += ESTIMATED_TEXT_SPRITE_BYTES;
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
