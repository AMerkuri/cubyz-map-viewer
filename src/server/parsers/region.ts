/**
 * Region file (.region) parser for Cubyz chunk data.
 * Format: [u32 version][u32 totalSize][u32*64 chunkLengths][chunk data...]
 * Each region contains 4x4x4 = 64 chunks.
 */

import { readFile } from "fs/promises";
import { inflateRawSync } from "zlib";
import { BinaryReader } from "./binary-reader.js";

export const CHUNK_SIZE = 32;
export const REGION_SIZE = 4;
export const REGION_VOLUME = REGION_SIZE ** 3; // 64
export const CHUNK_VOLUME = CHUNK_SIZE ** 3; // 32768

/** Compression algorithm enum matching Cubyz storage.zig */
enum ChunkCompressionAlgo {
  DeflateWithPositionNoBlockEntities = 0,
  DeflateNoBlockEntities = 1,
  Uniform = 2,
  DeflateWith8BitPaletteNoBlockEntities = 3,
  Deflate = 4,
  DeflateWith8BitPalette = 5,
}

export interface ChunkData {
  /** Block values as u32 array (32768 entries).
   *  block = (typ & 0xFFFF) | (data << 16)
   *  typ = block palette index, data = orientation/variant */
  blocks: Uint32Array;
  /** Position within region (0-3 for each axis) */
  rx: number;
  ry: number;
  rz: number;
}

export interface RegionData {
  chunks: (ChunkData | null)[];
  worldX: number;
  worldY: number;
  worldZ: number;
  voxelSize: number;
}

/**
 * Get the top (highest Z) non-air block at each (x, y) column in a chunk.
 * Returns an object with topBlocks[x*32+y] = block type index (0=air means no solid block).
 */
export function getChunkTopBlocks(chunk: ChunkData): Uint16Array {
  const top = new Uint16Array(CHUNK_SIZE * CHUNK_SIZE);
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let y = 0; y < CHUNK_SIZE; y++) {
      // Scan from top (z=31) down to z=0
      for (let z = CHUNK_SIZE - 1; z >= 0; z--) {
        const idx = x * CHUNK_SIZE * CHUNK_SIZE + y * CHUNK_SIZE + z;
        const blockValue = chunk.blocks[idx];
        const typ = blockValue & 0xffff;
        if (typ !== 0) {
          // Non-air block found
          top[x * CHUNK_SIZE + y] = typ;
          break;
        }
      }
    }
  }
  return top;
}

export async function parseRegionFile(
  filePath: string,
  worldX: number,
  worldY: number,
  worldZ: number,
  voxelSize: number
): Promise<RegionData> {
  const raw = await readFile(filePath);
  return parseRegionBuffer(raw, worldX, worldY, worldZ, voxelSize);
}

export function parseRegionBuffer(
  raw: Buffer,
  worldX: number,
  worldY: number,
  worldZ: number,
  voxelSize: number
): RegionData {
  const reader = new BinaryReader(raw);

  const version = reader.readU32();
  if (version !== 0) {
    throw new Error(`Unsupported region file version: ${version}`);
  }

  const _totalSize = reader.readU32();

  // Read 64 chunk data lengths
  const chunkLengths: number[] = [];
  for (let i = 0; i < REGION_VOLUME; i++) {
    chunkLengths.push(reader.readU32());
  }

  const chunks: (ChunkData | null)[] = new Array(REGION_VOLUME).fill(null);

  for (let i = 0; i < REGION_VOLUME; i++) {
    if (chunkLengths[i] === 0) continue;

    const chunkStart = reader.position;
    const rx = Math.floor(i / (REGION_SIZE * REGION_SIZE));
    const ry = Math.floor((i % (REGION_SIZE * REGION_SIZE)) / REGION_SIZE);
    const rz = i % REGION_SIZE;

    try {
      const blocks = decompressChunk(reader, chunkLengths[i]);
      chunks[i] = { blocks, rx, ry, rz };
    } catch (e) {
      // Skip malformed chunks
      console.warn(
        `Failed to decompress chunk ${i} in region (${worldX},${worldY},${worldZ}): ${e}`
      );
      reader.seek(chunkStart + chunkLengths[i]);
    }
  }

  return { chunks, worldX, worldY, worldZ, voxelSize };
}

function decompressChunk(reader: BinaryReader, length: number): Uint32Array {
  const startPos = reader.position;
  const algo = reader.readU32() as ChunkCompressionAlgo;

  switch (algo) {
    case ChunkCompressionAlgo.Uniform: {
      const blockValue = reader.readU32();
      const blocks = new Uint32Array(CHUNK_VOLUME);
      blocks.fill(blockValue);
      // Seek to end of chunk data
      reader.seek(startPos + length);
      return blocks;
    }

    case ChunkCompressionAlgo.DeflateWith8BitPalette:
    case ChunkCompressionAlgo.DeflateWith8BitPaletteNoBlockEntities: {
      const paletteLen = reader.readU8();
      const palette = new Uint32Array(paletteLen);
      for (let i = 0; i < paletteLen; i++) {
        palette[i] = reader.readU32();
      }
      const compressedSize = reader.readVarInt();
      const compressed = reader.readBytes(compressedSize);
      const decompressed = inflateRawSync(compressed);

      const blocks = new Uint32Array(CHUNK_VOLUME);
      for (let i = 0; i < CHUNK_VOLUME; i++) {
        const paletteIdx = decompressed[i];
        blocks[i] = paletteIdx < paletteLen ? palette[paletteIdx] : 0;
      }
      // Seek to end of chunk data (skip any block entity data)
      reader.seek(startPos + length);
      return blocks;
    }

    case ChunkCompressionAlgo.Deflate:
    case ChunkCompressionAlgo.DeflateNoBlockEntities: {
      const compressedSize = reader.readVarInt();
      const compressed = reader.readBytes(compressedSize);
      const decompressed = inflateRawSync(compressed);

      const blocks = new Uint32Array(CHUNK_VOLUME);
      const dataReader = new BinaryReader(decompressed);
      for (let i = 0; i < CHUNK_VOLUME; i++) {
        blocks[i] = dataReader.readU32();
      }
      reader.seek(startPos + length);
      return blocks;
    }

    case ChunkCompressionAlgo.DeflateWithPositionNoBlockEntities: {
      // Legacy format: 16 bytes position header + deflate
      reader.skip(16); // skip position data
      const compressedSize = reader.readVarInt();
      const compressed = reader.readBytes(compressedSize);
      const decompressed = inflateRawSync(compressed);

      const blocks = new Uint32Array(CHUNK_VOLUME);
      const dataReader = new BinaryReader(decompressed);
      for (let i = 0; i < CHUNK_VOLUME; i++) {
        blocks[i] = dataReader.readU32();
      }
      reader.seek(startPos + length);
      return blocks;
    }

    default:
      console.warn(`Unknown compression algo: ${algo}`);
      reader.seek(startPos + length);
      return new Uint32Array(CHUNK_VOLUME);
  }
}
