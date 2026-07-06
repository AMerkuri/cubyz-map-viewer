/**
 * Region file (.region) parser for Cubyz chunk data.
 * Format: [u32 version][u32 totalSize][u32*64 chunkLengths][chunk data...]
 * Each region contains 4x4x4 = 64 chunks.
 */

import { readFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import { BinaryReader } from "./binary-reader.js";

export const CHUNK_SIZE = 32;
export const REGION_SIZE = 4;
const REGION_VOLUME = REGION_SIZE ** 3; // 64
const CHUNK_VOLUME = CHUNK_SIZE ** 3; // 32768

/** Compression algorithm enum matching Cubyz storage.zig */
enum ChunkCompressionAlgo {
  DeflateWithPositionNoBlockEntities = 0,
  DeflateNoBlockEntities = 1,
  Uniform = 2,
  DeflateWith8BitPaletteNoBlockEntities = 3,
  Deflate = 4,
  DeflateWith8BitPalette = 5,
}

/**
 * A raw block-entity record recovered from a chunk's block-entity stream.
 * `positionIndex` is the chunk-local `u15` packed as `(x << 10) | (y << 5) | z`
 * within the 32x32x32 chunk. `payload` is the raw entity bytes (for signs this
 * is the UTF-8 text); interpretation is left to higher layers.
 */
export interface ChunkEntityRecord {
  positionIndex: number;
  payload: Buffer;
}

export interface ChunkData {
  /** Block values as u32 array (32768 entries).
   *  block = (typ & 0xFFFF) | (data << 16)
   *  typ = block palette index, data = orientation/variant */
  blocks: Uint32Array;
  /** Raw block-entity records recovered from the block-entity stream. */
  entities: ChunkEntityRecord[];
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

export async function parseRegionFile(
  filePath: string,
  worldX: number,
  worldY: number,
  worldZ: number,
  voxelSize: number,
): Promise<RegionData> {
  const raw = await readFile(filePath);
  return parseRegionBuffer(raw, worldX, worldY, worldZ, voxelSize, filePath);
}

function parseRegionBuffer(
  raw: Buffer,
  worldX: number,
  worldY: number,
  worldZ: number,
  voxelSize: number,
  filePath?: string,
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
      const { blocks, entities } = decompressChunk(reader, chunkLengths[i]);
      chunks[i] = { blocks, entities, rx, ry, rz };
    } catch (e) {
      // Skip malformed chunks
      console.warn(
        `Failed to decompress chunk ${i} in region (${worldX},${worldY},${worldZ})${filePath ? ` [${filePath}]` : ""}: ${e}`,
      );
      reader.seek(chunkStart + chunkLengths[i]);
    }
  }

  return { chunks, worldX, worldY, worldZ, voxelSize };
}

interface DecompressedChunk {
  blocks: Uint32Array;
  entities: ChunkEntityRecord[];
}

function decompressChunk(
  reader: BinaryReader,
  length: number,
): DecompressedChunk {
  const startPos = reader.position;
  const chunkEnd = startPos + length;
  const algo = reader.readU32() as ChunkCompressionAlgo;

  switch (algo) {
    case ChunkCompressionAlgo.Uniform: {
      const blockValue = reader.readU32();
      const blocks = new Uint32Array(CHUNK_VOLUME);
      blocks.fill(blockValue);
      // Uniform chunks carry a trailing block-entity stream after the header.
      const entities = decodeBlockEntityStream(reader, chunkEnd);
      reader.seek(chunkEnd);
      return { blocks, entities };
    }

    case ChunkCompressionAlgo.DeflateWith8BitPalette: {
      // algo 5: varInt compressedSize + deflate + block entity data
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
      // The block-entity stream is whatever remains after the deflate blob.
      const entities = decodeBlockEntityStream(reader, chunkEnd);
      reader.seek(chunkEnd);
      return { blocks, entities };
    }

    case ChunkCompressionAlgo.DeflateWith8BitPaletteNoBlockEntities: {
      // algo 3: no varInt — compressed data fills the rest of the chunk slice
      const paletteLen = reader.readU8();
      const palette = new Uint32Array(paletteLen);
      for (let i = 0; i < paletteLen; i++) {
        palette[i] = reader.readU32();
      }
      const compressedSize = length - (reader.position - startPos);
      const compressed = reader.readBytes(compressedSize);
      const decompressed = inflateRawSync(compressed);

      const blocks = new Uint32Array(CHUNK_VOLUME);
      for (let i = 0; i < CHUNK_VOLUME; i++) {
        const paletteIdx = decompressed[i];
        blocks[i] = paletteIdx < paletteLen ? palette[paletteIdx] : 0;
      }
      reader.seek(chunkEnd);
      return { blocks, entities: [] };
    }

    case ChunkCompressionAlgo.Deflate: {
      // algo 4: varInt compressedSize + deflate + block entity data
      const compressedSize = reader.readVarInt();
      const compressed = reader.readBytes(compressedSize);
      const decompressed = inflateRawSync(compressed);

      const blocks = new Uint32Array(CHUNK_VOLUME);
      const dataReader = new BinaryReader(decompressed);
      for (let i = 0; i < CHUNK_VOLUME; i++) {
        blocks[i] = dataReader.readU32();
      }
      // The block-entity stream is whatever remains after the deflate blob.
      const entities = decodeBlockEntityStream(reader, chunkEnd);
      reader.seek(chunkEnd);
      return { blocks, entities };
    }

    case ChunkCompressionAlgo.DeflateNoBlockEntities: {
      // algo 1: no varInt — compressed data fills the rest of the chunk slice
      const compressedSize = length - (reader.position - startPos);
      const compressed = reader.readBytes(compressedSize);
      const decompressed = inflateRawSync(compressed);

      const blocks = new Uint32Array(CHUNK_VOLUME);
      const dataReader = new BinaryReader(decompressed);
      for (let i = 0; i < CHUNK_VOLUME; i++) {
        blocks[i] = dataReader.readU32();
      }
      reader.seek(chunkEnd);
      return { blocks, entities: [] };
    }

    case ChunkCompressionAlgo.DeflateWithPositionNoBlockEntities: {
      // algo 0: 16 bytes position header, then no varInt — compressed data fills the rest
      reader.skip(16); // skip position data
      const compressedSize = length - (reader.position - startPos);
      const compressed = reader.readBytes(compressedSize);
      const decompressed = inflateRawSync(compressed);

      const blocks = new Uint32Array(CHUNK_VOLUME);
      const dataReader = new BinaryReader(decompressed);
      for (let i = 0; i < CHUNK_VOLUME; i++) {
        blocks[i] = dataReader.readU32();
      }
      reader.seek(chunkEnd);
      return { blocks, entities: [] };
    }

    default:
      console.warn(`Unknown compression algo: ${algo}`);
      reader.seek(chunkEnd);
      return { blocks: new Uint32Array(CHUNK_VOLUME), entities: [] };
  }
}

const BLOCK_ENTITY_ALGO_RAW = 0;

/**
 * Decode the block-entity stream that trails an entity-carrying chunk blob.
 *
 * Layout (from `reader.position` up to `chunkEnd`):
 *   - optional leading `u8` compression algorithm byte (`0` = raw), present
 *     only when the stream is non-empty
 *   - zero or more records: `u16` big-endian position index, LEB128 varint
 *     payload length, then that many raw payload bytes
 *
 * Parsing is fully defensive: every read is bounds-checked against `chunkEnd`,
 * and on truncation or an unknown algorithm the records parsed so far are
 * returned instead of throwing.
 */
function decodeBlockEntityStream(
  reader: BinaryReader,
  chunkEnd: number,
): ChunkEntityRecord[] {
  const records: ChunkEntityRecord[] = [];
  // Empty stream: nothing to decode, no leading algo byte.
  if (reader.position >= chunkEnd) return records;

  const algo = reader.readU8();
  // Only the raw (uncompressed) block-entity encoding is supported. Any other
  // value means a format we cannot decode; bail out with no records.
  if (algo !== BLOCK_ENTITY_ALGO_RAW) return records;

  while (reader.position + 2 <= chunkEnd) {
    const positionIndex = reader.readU16();
    const payloadLength = readVarIntBounded(reader, chunkEnd);
    if (payloadLength === null) break;
    if (payloadLength < 0 || reader.position + payloadLength > chunkEnd) break;
    const payload = Buffer.from(reader.readBytes(payloadLength));
    records.push({ positionIndex, payload });
  }

  return records;
}

/**
 * Read a LEB128 varint but never read past `chunkEnd`. Returns `null` when the
 * varint is truncated so the caller can stop parsing safely.
 */
function readVarIntBounded(
  reader: BinaryReader,
  chunkEnd: number,
): number | null {
  let result = 0;
  let shift = 0;
  while (reader.position < chunkEnd) {
    const byte = reader.readU8();
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return result;
    shift += 7;
  }
  return null;
}
