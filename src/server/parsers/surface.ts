/**
 * Surface file (.surface) parser for Cubyz map data.
 * Format: [u8 version][u8 neighborInfo][deflate compressed payload]
 * Decompressed: biome_u32[256*256] + height_i32[256*256] + origHeight_i32[256*256]
 */

import { readFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import { BinaryReader } from "./binary-reader.js";

export const MAP_SIZE = 256;

export interface SurfaceData {
  /** 256x256 biome palette indices, [x][y] row-major */
  biomes: Uint32Array;
  /** 256x256 height values (i32), [x][y] row-major */
  heights: Int32Array;
  /** 256x256 original heights before LOD interpolation */
  originalHeights: Int32Array;
  /** World coordinate X of this surface fragment */
  worldX: number;
  /** World coordinate Y of this surface fragment */
  worldY: number;
  /** LOD voxel size */
  voxelSize: number;
}

export async function parseSurfaceFile(
  filePath: string,
  worldX: number,
  worldY: number,
  voxelSize: number,
): Promise<SurfaceData> {
  const raw = await readFile(filePath);
  return parseSurfaceBuffer(raw, worldX, worldY, voxelSize);
}

export function parseSurfaceBuffer(
  raw: Buffer,
  worldX: number,
  worldY: number,
  voxelSize: number,
): SurfaceData {
  const reader = new BinaryReader(raw);

  const version = reader.readU8();
  if (version !== 1) {
    throw new Error(`Unsupported surface file version: ${version}`);
  }

  const _neighborInfo = reader.readU8();

  // Decompress the payload
  const compressedData = reader.readRemainingBytes();
  const decompressed = inflateRawSync(compressedData);

  const pixelCount = MAP_SIZE * MAP_SIZE;
  const expectedSize = pixelCount * 12; // 3 arrays * 4 bytes each
  if (decompressed.length !== expectedSize) {
    throw new Error(
      `Surface data size mismatch: got ${decompressed.length}, expected ${expectedSize}`,
    );
  }

  const dataReader = new BinaryReader(decompressed);

  // Read biome data: u32[256*256]
  const biomes = new Uint32Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    biomes[i] = dataReader.readU32();
  }

  // Read height data: i32[256*256]
  const heights = new Int32Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    heights[i] = dataReader.readI32();
  }

  // Read original height data: i32[256*256]
  const originalHeights = new Int32Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    originalHeights[i] = dataReader.readI32();
  }

  return { biomes, heights, originalHeights, worldX, worldY, voxelSize };
}
