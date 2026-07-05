/**
 * Greedy meshing wire-format helpers.
 * Converts merged quads into the compact binary payload consumed by the
 * voxel worker and client decoder.
 *
 * Binary layout
 * ─────────────
 * Header (20 bytes)
 *   i32  worldX
 *   i32  worldY
 *   i32  worldZBase
 *   u32  quadCount
 *   u32  voxelSize
 *
 * Per-quad colors  (3 × quadCount bytes, padded to 4-byte alignment)
 *   u8 r, u8 g, u8 b   — one entry per quad (client expands to 4 vertices)
 *
 * Per-quad face AO (quadCount bytes, padded to 4-byte alignment)
 *   u8 packedAo — 2 bits per corner, 0 for faces without AO
 *
 * Per-quad winding flags (quadCount bytes, padded to 4-byte alignment)
 *   u8 dir   — 1 for standard winding, 0 for flipped winding
 *
 * Per-vertex positions  (4 × quadCount × 12 bytes)
 *   u32 x   relative to worldX in 1/4096-cell fixed-point units
 *   u32 y   relative to worldY in 1/4096-cell fixed-point units
 *   u32 z   relative to worldZBase in 1/4096-cell fixed-point units
 *
 * Trailer (4 bytes)
 *   u32 chunkCoverage  — 16-bit bitmask, bit (cx*4+cy) set when the 32×32
 *                        chunk column at local offset (cx*32, cy*32) contains
 *                        at least one non-air block. The upper 16 bits are
 *                        always zero. 0xFFFF = all 16 columns covered.
 */

import type { BlockColorTable } from "./block-color-table.js";
import { VOXEL_POSITION_FIXED_SCALE } from "./block-shape-table.js";
import { FALLBACK_BLOCK_COLOR } from "./color-map.js";
import { logger } from "./logger.js";

const reportedFallbackPaletteIndices = new Set<number>();
const AIR_LIKE_COLOR = { r: 0, g: 0, b: 0 };

export interface BinaryQuad {
  v0x: number;
  v0y: number;
  v0z: number;
  v1x: number;
  v1y: number;
  v1z: number;
  v2x: number;
  v2y: number;
  v2z: number;
  v3x: number;
  v3y: number;
  v3z: number;
  typ: number;
  dir: number;
  packedAo: number;
}

/** Width/depth of one voxel region column in world blocks (4 chunks × 32 = 128) */
export const VOXEL_REGION_SIZE = 128;

export function encodeBinaryQuads(
  quads: BinaryQuad[],
  worldX: number,
  worldY: number,
  worldZ: number,
  voxelSize: number,
  blockColors: BlockColorTable,
  chunkCoverage: number,
): ArrayBuffer {
  let capacity = Math.max(4096, quads.length || 1);
  let quadCount = 0;
  let quadColors = new Uint8Array(capacity * 3);
  let quadAo = new Uint8Array(capacity);
  let quadDirections = new Uint8Array(capacity);
  let vertPosX = new Uint32Array(capacity * 4);
  let vertPosY = new Uint32Array(capacity * 4);
  let vertPosZ = new Uint32Array(capacity * 4);

  function ensureCapacity() {
    if (quadCount < capacity) return;
    capacity *= 2;
    const qc2 = new Uint8Array(capacity * 3);
    qc2.set(quadColors);
    quadColors = qc2;
    const qa2 = new Uint8Array(capacity);
    qa2.set(quadAo);
    quadAo = qa2;
    const qd2 = new Uint8Array(capacity);
    qd2.set(quadDirections);
    quadDirections = qd2;
    const vx2 = new Uint32Array(capacity * 4);
    vx2.set(vertPosX);
    vertPosX = vx2;
    const vy2 = new Uint32Array(capacity * 4);
    vy2.set(vertPosY);
    vertPosY = vy2;
    const vz2 = new Uint32Array(capacity * 4);
    vz2.set(vertPosZ);
    vertPosZ = vz2;
  }

  for (const quad of quads) {
    ensureCapacity();
    const qi = quadCount;
    const vi = qi * 4;
    const rgb = getBlockColor(blockColors, quad.typ);
    quadColors[qi * 3] = rgb.r;
    quadColors[qi * 3 + 1] = rgb.g;
    quadColors[qi * 3 + 2] = rgb.b;
    quadAo[qi] = quad.packedAo;
    quadDirections[qi] = quad.dir === 1 ? 1 : 0;

    vertPosX[vi] = toFixedPosition(quad.v0x);
    vertPosY[vi] = toFixedPosition(quad.v0y);
    vertPosZ[vi] = toFixedPosition(quad.v0z);
    vertPosX[vi + 1] = toFixedPosition(quad.v1x);
    vertPosY[vi + 1] = toFixedPosition(quad.v1y);
    vertPosZ[vi + 1] = toFixedPosition(quad.v1z);
    vertPosX[vi + 2] = toFixedPosition(quad.v2x);
    vertPosY[vi + 2] = toFixedPosition(quad.v2y);
    vertPosZ[vi + 2] = toFixedPosition(quad.v2z);
    vertPosX[vi + 3] = toFixedPosition(quad.v3x);
    vertPosY[vi + 3] = toFixedPosition(quad.v3y);
    vertPosZ[vi + 3] = toFixedPosition(quad.v3z);

    quadCount++;
  }

  const vertexCount = quadCount * 4;
  const colorBytes = quadCount * 3;
  const colorPadded = (colorBytes + 3) & ~3;
  const aoBytes = quadCount;
  const aoPadded = (aoBytes + 3) & ~3;
  const directionBytes = quadCount;
  const directionPadded = (directionBytes + 3) & ~3;
  const posBytes = vertexCount * 12;
  const totalBytes =
    20 + colorPadded + aoPadded + directionPadded + posBytes + 4;
  const buf = new ArrayBuffer(totalBytes);
  const view = new DataView(buf);

  view.setInt32(0, worldX, true);
  view.setInt32(4, worldY, true);
  view.setInt32(8, worldZ, true);
  view.setUint32(12, quadCount, true);
  view.setUint32(16, voxelSize, true);

  let off = 20;
  for (let qi = 0; qi < quadCount; qi++) {
    view.setUint8(off++, quadColors[qi * 3]);
    view.setUint8(off++, quadColors[qi * 3 + 1]);
    view.setUint8(off++, quadColors[qi * 3 + 2]);
  }
  off = 20 + colorPadded;

  for (let qi = 0; qi < quadCount; qi++) {
    view.setUint8(off++, quadAo[qi]);
  }
  off = 20 + colorPadded + aoPadded;

  for (let qi = 0; qi < quadCount; qi++) {
    view.setUint8(off++, quadDirections[qi]);
  }
  off = 20 + colorPadded + aoPadded + directionPadded;

  for (let vi = 0; vi < vertexCount; vi++) {
    view.setUint32(off, vertPosX[vi] ?? 0, true);
    off += 4;
    view.setUint32(off, vertPosY[vi] ?? 0, true);
    off += 4;
    view.setUint32(off, vertPosZ[vi] ?? 0, true);
    off += 4;
  }

  view.setUint32(off, chunkCoverage, true);
  return buf;
}

function toFixedPosition(value: number): number {
  return Math.max(0, Math.round(value * VOXEL_POSITION_FIXED_SCALE));
}

function getBlockColor(
  blockColors: BlockColorTable,
  paletteIndex: number,
): { r: number; g: number; b: number } {
  if (isAirLikePaletteIndex(blockColors, paletteIndex)) {
    return AIR_LIKE_COLOR;
  }

  const off = paletteIndex * 3;
  if (off + 2 >= blockColors.rgb.length) {
    if (!reportedFallbackPaletteIndices.has(paletteIndex)) {
      reportedFallbackPaletteIndices.add(paletteIndex);
      logger.error("Using fallback block color for palette index", {
        paletteIndex,
        availableColorEntries: Math.floor(blockColors.rgb.length / 3),
        fallbackColor: FALLBACK_BLOCK_COLOR,
        reason: "palette index out of range",
      });
    }
    return FALLBACK_BLOCK_COLOR;
  }
  return {
    r: blockColors.rgb[off],
    g: blockColors.rgb[off + 1],
    b: blockColors.rgb[off + 2],
  };
}

function isAirLikePaletteIndex(
  blockColors: BlockColorTable,
  paletteIndex: number,
): boolean {
  return paletteIndex === 0 || blockColors.airLike[paletteIndex] === 1;
}
