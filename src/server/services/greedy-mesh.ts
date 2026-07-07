/**
 * Greedy meshing wire-format helpers.
 * Converts merged quads into the compact binary payload consumed by the
 * voxel worker and client decoder.
 *
 * Binary layout
 * ─────────────
 * Header (24 bytes)
 *   u32  magic/version marker
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
 * Per-quad block palette indices (2 × quadCount bytes, padded to 4-byte alignment)
 *   u16 typ — save block palette index for the rendered quad, 0xFFFF if out of range
 *
 * Per-quad render kinds (quadCount bytes, padded to 4-byte alignment)
 *   u8 renderKind — 1 opaque, 2 transparent
 *
 * Per-quad source kinds (quadCount bytes, padded to 4-byte alignment)
 *   u8 sourceKind — 1 greedy cube, 2 model/semantic geometry
 *
 * Per-quad position kinds (quadCount bytes, padded to 4-byte alignment)
 *   u8 positionKind — 1 u16 integer cell coordinates, 2 u32 fixed-point
 *
 * Per-vertex positions  (4 vertices per quad)
 *   positionKind 1: u16 x, u16 y, u16 z relative to worldX/Y/ZBase in cells
 *   positionKind 2: u32 x, u32 y, u32 z relative to worldX/Y/ZBase in 1/4096-cell fixed-point units
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
const reportedOutOfRangePaletteIndices = new Set<number>();
const AIR_LIKE_COLOR = { r: 0, g: 0, b: 0 };
const MISSING_BLOCK_PALETTE_INDEX = 0xffff;
const VOXEL_BINARY_MAGIC = 0x324d5856;
const POSITION_KIND_INTEGER = 1;
const POSITION_KIND_FIXED = 2;
const SOURCE_KIND_GREEDY = 1;
const SOURCE_KIND_MODEL = 2;

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
  renderKind: number;
  sourceKind?: "greedy" | "model";
}

interface BinaryQuadMetrics {
  quadCount: number;
  greedyCubeQuads: number;
  modelQuads: number;
  transparentQuads: number;
  rawPayloadBytes: number;
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
): { buffer: ArrayBuffer; metrics: BinaryQuadMetrics } {
  let capacity = Math.max(4096, quads.length || 1);
  let quadCount = 0;
  let quadColors = new Uint8Array(capacity * 3);
  let quadAo = new Uint8Array(capacity);
  let quadDirections = new Uint8Array(capacity);
  let quadPaletteIndices = new Uint16Array(capacity);
  let quadRenderKinds = new Uint8Array(capacity);
  let quadSourceKinds = new Uint8Array(capacity);
  let quadPositionKinds = new Uint8Array(capacity);
  let vertPosX = new Uint32Array(capacity * 4);
  let vertPosY = new Uint32Array(capacity * 4);
  let vertPosZ = new Uint32Array(capacity * 4);
  let greedyCubeQuads = 0;
  let modelQuads = 0;
  let transparentQuads = 0;
  let positionBytes = 0;

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
    const qp2 = new Uint16Array(capacity);
    qp2.set(quadPaletteIndices);
    quadPaletteIndices = qp2;
    const qr2 = new Uint8Array(capacity);
    qr2.set(quadRenderKinds);
    quadRenderKinds = qr2;
    const qs2 = new Uint8Array(capacity);
    qs2.set(quadSourceKinds);
    quadSourceKinds = qs2;
    const qpk2 = new Uint8Array(capacity);
    qpk2.set(quadPositionKinds);
    quadPositionKinds = qpk2;
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
    quadPaletteIndices[qi] = toWirePaletteIndex(quad.typ);
    quadRenderKinds[qi] = quad.renderKind === 2 ? 2 : 1;
    if (quadRenderKinds[qi] === 2) transparentQuads++;
    if (quad.sourceKind === "model") {
      quadSourceKinds[qi] = SOURCE_KIND_MODEL;
      modelQuads++;
    } else {
      quadSourceKinds[qi] = SOURCE_KIND_GREEDY;
      greedyCubeQuads++;
    }
    const integerPositionKind = canEncodeIntegerPositions(quad);
    quadPositionKinds[qi] = integerPositionKind
      ? POSITION_KIND_INTEGER
      : POSITION_KIND_FIXED;
    positionBytes += integerPositionKind ? 4 * 3 * 2 : 4 * 3 * 4;

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

  const colorBytes = quadCount * 3;
  const colorPadded = (colorBytes + 3) & ~3;
  const aoBytes = quadCount;
  const aoPadded = (aoBytes + 3) & ~3;
  const directionBytes = quadCount;
  const directionPadded = (directionBytes + 3) & ~3;
  const paletteBytes = quadCount * 2;
  const palettePadded = (paletteBytes + 3) & ~3;
  const renderKindBytes = quadCount;
  const renderKindPadded = (renderKindBytes + 3) & ~3;
  const sourceKindBytes = quadCount;
  const sourceKindPadded = (sourceKindBytes + 3) & ~3;
  const positionKindBytes = quadCount;
  const positionKindPadded = (positionKindBytes + 3) & ~3;
  const totalBytes =
    24 +
    colorPadded +
    aoPadded +
    directionPadded +
    palettePadded +
    renderKindPadded +
    sourceKindPadded +
    positionKindPadded +
    positionBytes +
    4;
  const buf = new ArrayBuffer(totalBytes);
  const view = new DataView(buf);

  view.setUint32(0, VOXEL_BINARY_MAGIC, true);
  view.setInt32(4, worldX, true);
  view.setInt32(8, worldY, true);
  view.setInt32(12, worldZ, true);
  view.setUint32(16, quadCount, true);
  view.setUint32(20, voxelSize, true);

  let off = 24;
  for (let qi = 0; qi < quadCount; qi++) {
    view.setUint8(off++, quadColors[qi * 3]);
    view.setUint8(off++, quadColors[qi * 3 + 1]);
    view.setUint8(off++, quadColors[qi * 3 + 2]);
  }
  off = 24 + colorPadded;

  for (let qi = 0; qi < quadCount; qi++) {
    view.setUint8(off++, quadAo[qi]);
  }
  off = 24 + colorPadded + aoPadded;

  for (let qi = 0; qi < quadCount; qi++) {
    view.setUint8(off++, quadDirections[qi]);
  }
  off = 24 + colorPadded + aoPadded + directionPadded;

  for (let qi = 0; qi < quadCount; qi++) {
    view.setUint16(
      off,
      quadPaletteIndices[qi] ?? MISSING_BLOCK_PALETTE_INDEX,
      true,
    );
    off += 2;
  }
  off = 24 + colorPadded + aoPadded + directionPadded + palettePadded;

  for (let qi = 0; qi < quadCount; qi++) {
    view.setUint8(off++, quadRenderKinds[qi] ?? 1);
  }
  off =
    24 +
    colorPadded +
    aoPadded +
    directionPadded +
    palettePadded +
    renderKindPadded;

  for (let qi = 0; qi < quadCount; qi++) {
    view.setUint8(off++, quadSourceKinds[qi] ?? SOURCE_KIND_GREEDY);
  }
  off =
    24 +
    colorPadded +
    aoPadded +
    directionPadded +
    palettePadded +
    renderKindPadded +
    sourceKindPadded;

  for (let qi = 0; qi < quadCount; qi++) {
    view.setUint8(off++, quadPositionKinds[qi] ?? POSITION_KIND_FIXED);
  }
  off =
    24 +
    colorPadded +
    aoPadded +
    directionPadded +
    palettePadded +
    renderKindPadded +
    sourceKindPadded +
    positionKindPadded;

  for (let qi = 0; qi < quadCount; qi++) {
    for (let corner = 0; corner < 4; corner++) {
      const vi = qi * 4 + corner;
      if (quadPositionKinds[qi] === POSITION_KIND_INTEGER) {
        view.setUint16(
          off,
          (vertPosX[vi] ?? 0) / VOXEL_POSITION_FIXED_SCALE,
          true,
        );
        off += 2;
        view.setUint16(
          off,
          (vertPosY[vi] ?? 0) / VOXEL_POSITION_FIXED_SCALE,
          true,
        );
        off += 2;
        view.setUint16(
          off,
          (vertPosZ[vi] ?? 0) / VOXEL_POSITION_FIXED_SCALE,
          true,
        );
        off += 2;
      } else {
        view.setUint32(off, vertPosX[vi] ?? 0, true);
        off += 4;
        view.setUint32(off, vertPosY[vi] ?? 0, true);
        off += 4;
        view.setUint32(off, vertPosZ[vi] ?? 0, true);
        off += 4;
      }
    }
  }

  view.setUint32(off, chunkCoverage, true);
  return {
    buffer: buf,
    metrics: {
      quadCount,
      greedyCubeQuads,
      modelQuads,
      transparentQuads,
      rawPayloadBytes: buf.byteLength,
    },
  };
}

export function readBinaryQuadMetrics(buf: ArrayBuffer): BinaryQuadMetrics {
  const view = new DataView(buf);
  const header = readBinaryHeader(view, buf.byteLength);
  const layout = getBinaryQuadLayout(header.quadCount, header.headerBytes);
  let transparentQuads = 0;
  let greedyCubeQuads = 0;
  let modelQuads = 0;
  for (let qi = 0; qi < header.quadCount; qi++) {
    if (view.getUint8(layout.renderKindOffset + qi) === 2) transparentQuads++;
    if (header.hasSourceKinds) {
      if (view.getUint8(layout.sourceKindOffset + qi) === SOURCE_KIND_MODEL) {
        modelQuads++;
      } else {
        greedyCubeQuads++;
      }
    }
  }
  if (!header.hasSourceKinds) greedyCubeQuads = header.quadCount;
  return {
    quadCount: header.quadCount,
    greedyCubeQuads,
    modelQuads,
    transparentQuads,
    rawPayloadBytes: buf.byteLength,
  };
}

export function getBinaryQuadPositionOffset(buf: ArrayBufferLike): number {
  const view = new DataView(buf);
  const header = readBinaryHeader(view, buf.byteLength);
  return getBinaryQuadLayout(header.quadCount, header.headerBytes)
    .positionOffset;
}

export function getBinaryQuadPositionKindOffset(buf: ArrayBufferLike): number {
  const view = new DataView(buf);
  const header = readBinaryHeader(view, buf.byteLength);
  return getBinaryQuadLayout(header.quadCount, header.headerBytes)
    .positionKindOffset;
}

export function readBinaryHeader(
  view: DataView,
  byteLength: number,
): {
  worldX: number;
  worldY: number;
  worldZ: number;
  quadCount: number;
  voxelSize: number;
  headerBytes: number;
  hasSourceKinds: boolean;
  hasPositionKinds: boolean;
} {
  if (byteLength < 20) throw new Error("buffer too small for voxel header");
  if (byteLength >= 24 && view.getUint32(0, true) === VOXEL_BINARY_MAGIC) {
    return {
      worldX: view.getInt32(4, true),
      worldY: view.getInt32(8, true),
      worldZ: view.getInt32(12, true),
      quadCount: view.getUint32(16, true),
      voxelSize: view.getUint32(20, true) || 1,
      headerBytes: 24,
      hasSourceKinds: true,
      hasPositionKinds: true,
    };
  }
  return {
    worldX: view.getInt32(0, true),
    worldY: view.getInt32(4, true),
    worldZ: view.getInt32(8, true),
    quadCount: view.getUint32(12, true),
    voxelSize: view.getUint32(16, true) || 1,
    headerBytes: 20,
    hasSourceKinds: false,
    hasPositionKinds: false,
  };
}

function getBinaryQuadLayout(quadCount: number, headerBytes: number) {
  const colorPadded = (quadCount * 3 + 3) & ~3;
  const aoPadded = (quadCount + 3) & ~3;
  const directionPadded = (quadCount + 3) & ~3;
  const palettePadded = (quadCount * 2 + 3) & ~3;
  const renderKindPadded = (quadCount + 3) & ~3;
  const sourceKindPadded = headerBytes === 24 ? (quadCount + 3) & ~3 : 0;
  const positionKindPadded = headerBytes === 24 ? (quadCount + 3) & ~3 : 0;
  const aoOffset = headerBytes + colorPadded;
  const directionOffset = aoOffset + aoPadded;
  const paletteOffset = directionOffset + directionPadded;
  const renderKindOffset = paletteOffset + palettePadded;
  const sourceKindOffset = renderKindOffset + renderKindPadded;
  const positionKindOffset = sourceKindOffset + sourceKindPadded;
  const positionOffset = positionKindOffset + positionKindPadded;
  return {
    aoOffset,
    directionOffset,
    paletteOffset,
    renderKindOffset,
    sourceKindOffset,
    positionKindOffset,
    positionOffset,
  };
}

function canEncodeIntegerPositions(quad: BinaryQuad): boolean {
  return [
    quad.v0x,
    quad.v0y,
    quad.v0z,
    quad.v1x,
    quad.v1y,
    quad.v1z,
    quad.v2x,
    quad.v2y,
    quad.v2z,
    quad.v3x,
    quad.v3y,
    quad.v3z,
  ].every((value) => Number.isInteger(value) && value >= 0 && value <= 0xffff);
}

function toFixedPosition(value: number): number {
  return Math.max(0, Math.round(value * VOXEL_POSITION_FIXED_SCALE));
}

function toWirePaletteIndex(paletteIndex: number): number {
  if (paletteIndex >= 0 && paletteIndex < MISSING_BLOCK_PALETTE_INDEX) {
    return paletteIndex;
  }
  if (!reportedOutOfRangePaletteIndices.has(paletteIndex)) {
    reportedOutOfRangePaletteIndices.add(paletteIndex);
    logger.error(
      "Omitting out-of-range block palette index from voxel payload",
      {
        paletteIndex,
        maxWirePaletteIndex: MISSING_BLOCK_PALETTE_INDEX - 1,
      },
    );
  }
  return MISSING_BLOCK_PALETTE_INDEX;
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
