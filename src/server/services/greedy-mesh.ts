/**
 * Greedy meshing wire-format helpers.
 * Converts merged quads into the compact binary payload consumed by the
 * voxel worker and client decoder.
 *
 * Binary layout
 * ─────────────
 * Header (36 bytes)
 *   u32  magic/version marker
 *   i32  worldX
 *   i32  worldY
 *   i32  worldZBase
 *   u32  quadCount
 *   u32  voxelSize
 *   u32  greedyRecordCount
 *   u32  modelRecordCount
 *   u32  emitterRecordCount
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
 * Greedy records (12 × greedyRecordCount bytes)
 *   u8 face, u8 reserved, u16 plane, u16 u, u16 v, u16 du, u16 dv
 *
 * Model/fractional records (48 × modelRecordCount bytes)
 *   four vertices as u32 x/y/z relative to worldX/Y/ZBase in 1/4096-cell fixed-point units
 *
 * Emitter records (16 × emitterRecordCount bytes)
 *   i32 x, i32 y, i32 z relative to worldX/Y/ZBase in voxel cells
 *   u8 r, u8 g, u8 b, u8 flags (bit 0 halo, bits 1-6 open face mask)
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
const VOXEL_BINARY_MAGIC = 0x354d5856;
const UINT16_EMITTER_VOXEL_BINARY_MAGIC = 0x344d5856;
const PRE_EMITTER_VOXEL_BINARY_MAGIC = 0x334d5856;
const LEGACY_VOXEL_BINARY_MAGIC = 0x324d5856;
export const GREEDY_RECORD_BYTES = 12;
const MODEL_RECORD_BYTES = 48;
const EMITTER_RECORD_BYTES = 16;

export type GreedyFaceCode = 0 | 1 | 2 | 3 | 4 | 5;

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
  face?: GreedyFaceCode;
  plane?: number;
  u?: number;
  v?: number;
  du?: number;
  dv?: number;
}

export interface BinaryEmitterRecord {
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
  halo?: boolean;
  openFaces?: number;
}

interface BinaryQuadMetrics {
  quadCount: number;
  greedyCubeQuads: number;
  modelQuads: number;
  transparentQuads: number;
  rawPayloadBytes: number;
  greedyRecordBytes: number;
  modelRecordBytes: number;
  emitterRecords: number;
  emitterRecordBytes: number;
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
  emitterRecords: BinaryEmitterRecord[] = [],
): { buffer: ArrayBuffer; metrics: BinaryQuadMetrics } {
  const sortedQuads = [...quads].sort((a, b) => {
    const aModel = a.sourceKind === "model" ? 1 : 0;
    const bModel = b.sourceKind === "model" ? 1 : 0;
    return aModel - bModel;
  });
  const validEmitterRecords = emitterRecords.filter(isInt32CellEmitter);
  if (validEmitterRecords.length !== emitterRecords.length) {
    logger.warn("Dropped out-of-range voxel emitter records", {
      dropped: emitterRecords.length - validEmitterRecords.length,
      retained: validEmitterRecords.length,
    });
  }
  let capacity = Math.max(4096, sortedQuads.length || 1);
  let quadCount = 0;
  let quadColors = new Uint8Array(capacity * 3);
  let quadAo = new Uint8Array(capacity);
  let quadDirections = new Uint8Array(capacity);
  let quadPaletteIndices = new Uint16Array(capacity);
  let quadRenderKinds = new Uint8Array(capacity);
  let greedyFaces = new Uint8Array(capacity);
  let greedyPlanes = new Uint16Array(capacity);
  let greedyU = new Uint16Array(capacity);
  let greedyV = new Uint16Array(capacity);
  let greedyDu = new Uint16Array(capacity);
  let greedyDv = new Uint16Array(capacity);
  let vertPosX = new Uint32Array(capacity * 4);
  let vertPosY = new Uint32Array(capacity * 4);
  let vertPosZ = new Uint32Array(capacity * 4);
  let greedyCubeQuads = 0;
  let modelQuads = 0;
  let transparentQuads = 0;

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
    const gf2 = new Uint8Array(capacity);
    gf2.set(greedyFaces);
    greedyFaces = gf2;
    const gp2 = new Uint16Array(capacity);
    gp2.set(greedyPlanes);
    greedyPlanes = gp2;
    const gu2 = new Uint16Array(capacity);
    gu2.set(greedyU);
    greedyU = gu2;
    const gv2 = new Uint16Array(capacity);
    gv2.set(greedyV);
    greedyV = gv2;
    const gdu2 = new Uint16Array(capacity);
    gdu2.set(greedyDu);
    greedyDu = gdu2;
    const gdv2 = new Uint16Array(capacity);
    gdv2.set(greedyDv);
    greedyDv = gdv2;
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

  for (const quad of sortedQuads) {
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
      modelQuads++;
    } else {
      if (!isParametricGreedyQuad(quad)) {
        throw new Error("greedy voxel quad missing parametric fields");
      }
      greedyFaces[greedyCubeQuads] = quad.face;
      greedyPlanes[greedyCubeQuads] = toUint16Cell(quad.plane, "plane");
      greedyU[greedyCubeQuads] = toUint16Cell(quad.u, "u");
      greedyV[greedyCubeQuads] = toUint16Cell(quad.v, "v");
      greedyDu[greedyCubeQuads] = toUint16Cell(quad.du, "du");
      greedyDv[greedyCubeQuads] = toUint16Cell(quad.dv, "dv");
      greedyCubeQuads++;
    }

    if (quad.sourceKind === "model") {
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
    }

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
  const greedyRecordBytes = greedyCubeQuads * GREEDY_RECORD_BYTES;
  const modelRecordBytes = modelQuads * MODEL_RECORD_BYTES;
  const emitterRecordBytes = validEmitterRecords.length * EMITTER_RECORD_BYTES;
  const totalBytes =
    36 +
    colorPadded +
    aoPadded +
    directionPadded +
    palettePadded +
    renderKindPadded +
    greedyRecordBytes +
    modelRecordBytes +
    emitterRecordBytes +
    4;
  const buf = new ArrayBuffer(totalBytes);
  const view = new DataView(buf);

  view.setUint32(0, VOXEL_BINARY_MAGIC, true);
  view.setInt32(4, worldX, true);
  view.setInt32(8, worldY, true);
  view.setInt32(12, worldZ, true);
  view.setUint32(16, quadCount, true);
  view.setUint32(20, voxelSize, true);
  view.setUint32(24, greedyCubeQuads, true);
  view.setUint32(28, modelQuads, true);
  view.setUint32(32, validEmitterRecords.length, true);

  let off = 36;
  for (let qi = 0; qi < quadCount; qi++) {
    view.setUint8(off++, quadColors[qi * 3]);
    view.setUint8(off++, quadColors[qi * 3 + 1]);
    view.setUint8(off++, quadColors[qi * 3 + 2]);
  }
  off = 36 + colorPadded;

  for (let qi = 0; qi < quadCount; qi++) {
    view.setUint8(off++, quadAo[qi]);
  }
  off = 36 + colorPadded + aoPadded;

  for (let qi = 0; qi < quadCount; qi++) {
    view.setUint8(off++, quadDirections[qi]);
  }
  off = 36 + colorPadded + aoPadded + directionPadded;

  for (let qi = 0; qi < quadCount; qi++) {
    view.setUint16(
      off,
      quadPaletteIndices[qi] ?? MISSING_BLOCK_PALETTE_INDEX,
      true,
    );
    off += 2;
  }
  off = 36 + colorPadded + aoPadded + directionPadded + palettePadded;

  for (let qi = 0; qi < quadCount; qi++) {
    view.setUint8(off++, quadRenderKinds[qi] ?? 1);
  }
  off =
    36 +
    colorPadded +
    aoPadded +
    directionPadded +
    palettePadded +
    renderKindPadded;

  for (let qi = 0; qi < greedyCubeQuads; qi++) {
    view.setUint8(off++, greedyFaces[qi] ?? 0);
    view.setUint8(off++, 0);
    view.setUint16(off, greedyPlanes[qi] ?? 0, true);
    off += 2;
    view.setUint16(off, greedyU[qi] ?? 0, true);
    off += 2;
    view.setUint16(off, greedyV[qi] ?? 0, true);
    off += 2;
    view.setUint16(off, greedyDu[qi] ?? 0, true);
    off += 2;
    view.setUint16(off, greedyDv[qi] ?? 0, true);
    off += 2;
  }

  for (let qi = greedyCubeQuads; qi < quadCount; qi++) {
    for (let corner = 0; corner < 4; corner++) {
      const vi = qi * 4 + corner;
      view.setUint32(off, vertPosX[vi] ?? 0, true);
      off += 4;
      view.setUint32(off, vertPosY[vi] ?? 0, true);
      off += 4;
      view.setUint32(off, vertPosZ[vi] ?? 0, true);
      off += 4;
    }
  }

  for (const emitter of validEmitterRecords) {
    view.setInt32(off, toInt32Cell(emitter.x, "emitter x"), true);
    off += 4;
    view.setInt32(off, toInt32Cell(emitter.y, "emitter y"), true);
    off += 4;
    view.setInt32(off, toInt32Cell(emitter.z, "emitter z"), true);
    off += 4;
    view.setUint8(off++, clampByte(emitter.r));
    view.setUint8(off++, clampByte(emitter.g));
    view.setUint8(off++, clampByte(emitter.b));
    view.setUint8(
      off++,
      (emitter.halo ? 1 : 0) | ((emitter.openFaces ?? 0) << 1),
    );
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
      greedyRecordBytes,
      modelRecordBytes,
      emitterRecords: validEmitterRecords.length,
      emitterRecordBytes,
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
    if (header.greedyRecordCount !== undefined) {
      if (qi < header.greedyRecordCount) greedyCubeQuads++;
      else modelQuads++;
    } else if (header.hasSourceKinds) {
      const sourceKindOffset = layout.sourceKindOffset ?? 0;
      if (view.getUint8(sourceKindOffset + qi) === 2) modelQuads++;
      else greedyCubeQuads++;
    }
  }
  if (!header.hasSourceKinds && header.greedyRecordCount === undefined) {
    greedyCubeQuads = header.quadCount;
  }
  return {
    quadCount: header.quadCount,
    greedyCubeQuads,
    modelQuads,
    transparentQuads,
    rawPayloadBytes: buf.byteLength,
    greedyRecordBytes: greedyCubeQuads * GREEDY_RECORD_BYTES,
    modelRecordBytes: modelQuads * MODEL_RECORD_BYTES,
    emitterRecords: header.emitterRecordCount ?? 0,
    emitterRecordBytes: (header.emitterRecordCount ?? 0) * EMITTER_RECORD_BYTES,
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
  const positionKindOffset = getBinaryQuadLayout(
    header.quadCount,
    header.headerBytes,
  ).positionKindOffset;
  if (positionKindOffset === undefined) {
    throw new Error("voxel payload has no legacy position-kind section");
  }
  return positionKindOffset;
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
  greedyRecordCount?: number;
  modelRecordCount?: number;
  emitterRecordCount?: number;
} {
  if (byteLength < 20) throw new Error("buffer too small for voxel header");
  if (
    byteLength >= 36 &&
    (view.getUint32(0, true) === VOXEL_BINARY_MAGIC ||
      view.getUint32(0, true) === UINT16_EMITTER_VOXEL_BINARY_MAGIC)
  ) {
    return {
      worldX: view.getInt32(4, true),
      worldY: view.getInt32(8, true),
      worldZ: view.getInt32(12, true),
      quadCount: view.getUint32(16, true),
      voxelSize: view.getUint32(20, true) || 1,
      headerBytes: 36,
      hasSourceKinds: false,
      hasPositionKinds: false,
      greedyRecordCount: view.getUint32(24, true),
      modelRecordCount: view.getUint32(28, true),
      emitterRecordCount: view.getUint32(32, true),
    };
  }
  if (byteLength >= 32 && view.getUint32(0, true) === VOXEL_BINARY_MAGIC) {
    return {
      worldX: view.getInt32(4, true),
      worldY: view.getInt32(8, true),
      worldZ: view.getInt32(12, true),
      quadCount: view.getUint32(16, true),
      voxelSize: view.getUint32(20, true) || 1,
      headerBytes: 32,
      hasSourceKinds: false,
      hasPositionKinds: false,
      greedyRecordCount: view.getUint32(24, true),
      modelRecordCount: view.getUint32(28, true),
    };
  }
  if (
    byteLength >= 32 &&
    view.getUint32(0, true) === PRE_EMITTER_VOXEL_BINARY_MAGIC
  ) {
    return {
      worldX: view.getInt32(4, true),
      worldY: view.getInt32(8, true),
      worldZ: view.getInt32(12, true),
      quadCount: view.getUint32(16, true),
      voxelSize: view.getUint32(20, true) || 1,
      headerBytes: 32,
      hasSourceKinds: false,
      hasPositionKinds: false,
      greedyRecordCount: view.getUint32(24, true),
      modelRecordCount: view.getUint32(28, true),
      emitterRecordCount: 0,
    };
  }
  if (
    byteLength >= 24 &&
    view.getUint32(0, true) === LEGACY_VOXEL_BINARY_MAGIC
  ) {
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
    sourceKindOffset: headerBytes === 24 ? sourceKindOffset : undefined,
    positionKindOffset: headerBytes === 24 ? positionKindOffset : undefined,
    positionOffset,
  };
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function isParametricGreedyQuad(quad: BinaryQuad): quad is BinaryQuad & {
  face: GreedyFaceCode;
  plane: number;
  u: number;
  v: number;
  du: number;
  dv: number;
} {
  return (
    quad.face !== undefined &&
    quad.plane !== undefined &&
    quad.u !== undefined &&
    quad.v !== undefined &&
    quad.du !== undefined &&
    quad.dv !== undefined
  );
}

function toUint16Cell(value: number, field: string): number {
  if (Number.isInteger(value) && value >= 0 && value <= 0xffff) return value;
  throw new Error(`greedy voxel ${field} out of u16 range: ${value}`);
}

function isInt32CellEmitter(record: BinaryEmitterRecord): boolean {
  return (
    Number.isInteger(record.x) &&
    record.x >= -0x80000000 &&
    record.x <= 0x7fffffff &&
    Number.isInteger(record.y) &&
    record.y >= -0x80000000 &&
    record.y <= 0x7fffffff &&
    Number.isInteger(record.z) &&
    record.z >= -0x80000000 &&
    record.z <= 0x7fffffff
  );
}

function toInt32Cell(value: number, label: string): number {
  if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff) {
    throw new Error(`${label} out of int32 range: ${value}`);
  }
  return value;
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
