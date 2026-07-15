import type { BlockColorTable } from "./block-color-table.js";
import {
  type BlockSemanticShape,
  type BlockShape,
  type BlockShapeTable,
  resolveShapeForLod,
} from "./block-shape-table.js";

export const EMITTER_OPEN_FACE_X_POS = 1 << 0;
export const EMITTER_OPEN_FACE_X_NEG = 1 << 1;
export const EMITTER_OPEN_FACE_Y_POS = 1 << 2;
export const EMITTER_OPEN_FACE_Y_NEG = 1 << 3;
export const EMITTER_OPEN_FACE_Z_POS = 1 << 4;
export const EMITTER_OPEN_FACE_Z_NEG = 1 << 5;

const VALID_LODS = [1, 2, 4, 8, 16, 32];

export type VoxelFace = "x-" | "x+" | "y-" | "y+" | "z+" | "z-";

export interface RepresentedEmitterSource {
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
  openFaces: number;
  representedLods: number;
}

export function getPaletteIndex(blockValue: number): number {
  return blockValue & 0xffff;
}

export function getBlockData(blockValue: number): number {
  return blockValue >>> 16;
}

export function isAirType(
  blockColors: BlockColorTable,
  paletteIndex: number,
): boolean {
  return paletteIndex === 0 || blockColors.airLike[paletteIndex] === 1;
}

export function isTransparentType(
  blockColors: BlockColorTable,
  paletteIndex: number,
): boolean {
  return blockColors.renderKind[paletteIndex] === 2;
}

export function getEmittedLight(
  blockColors: BlockColorTable,
  paletteIndex: number,
): { r: number; g: number; b: number } | null {
  const offset = paletteIndex * 3;
  if (offset + 2 >= blockColors.emittedLightRgb.length) return null;
  const r = blockColors.emittedLightRgb[offset] ?? 0;
  const g = blockColors.emittedLightRgb[offset + 1] ?? 0;
  const b = blockColors.emittedLightRgb[offset + 2] ?? 0;
  return r === 0 && g === 0 && b === 0 ? null : { r, g, b };
}

export function isTraversableBlockValue(
  blockColors: BlockColorTable,
  blockShapes: BlockShapeTable,
  blockValue: number,
  lod: number,
): boolean {
  const paletteIndex = getPaletteIndex(blockValue);
  if (isAirType(blockColors, paletteIndex)) return true;
  if (isTransparentType(blockColors, paletteIndex)) return true;
  const shape = resolveShapeForLod(blockShapes, paletteIndex, lod);
  if (shape.kind === "model") return true;
  if (shape.kind !== "semantic") return false;
  return isTraversableSemantic(shape, getBlockData(blockValue), lod);
}

export function isBlockBoundarySolid(
  blockColors: BlockColorTable,
  blockShapes: BlockShapeTable,
  blockValue: number,
  face: VoxelFace,
  lod: number,
): boolean {
  const paletteIndex = getPaletteIndex(blockValue);
  if (
    isAirType(blockColors, paletteIndex) ||
    isTransparentType(blockColors, paletteIndex)
  ) {
    return false;
  }
  const shape = resolveShapeForLod(blockShapes, paletteIndex, lod);
  if (shape.kind !== "semantic") return false;
  return isSemanticBoundarySolid(shape, getBlockData(blockValue), face, lod);
}

export function getRepresentedLodMask(
  blockShapes: BlockShapeTable,
  paletteIndex: number,
): number {
  let mask = 0;
  for (const lod of VALID_LODS) {
    if (resolveShapeForLod(blockShapes, paletteIndex, lod).kind !== "air") {
      mask |= 1 << Math.log2(lod);
    }
  }
  return mask;
}

export function hasDetailedRepresentation(
  shape: BlockShape,
  blockData: number,
): boolean {
  if (shape.kind === "air") return false;
  if (shape.kind === "cube") return true;
  if (shape.kind === "model") {
    if (shape.rotation !== "cubyz:torch") return shape.quads.length > 0;
    const data = blockData === 0 ? 1 : blockData & 0x1f;
    return (
      ((data & 1) !== 0 && shape.quads.length > 0) ||
      ((data & 0x1e) !== 0 && shape.sideQuads.length > 0)
    );
  }

  switch (shape.semantic) {
    case "cubyz:stairs": {
      const removed = blockData & 0xff;
      return removed !== 0 && removed !== 0xff;
    }
    case "cubyz:fence":
    case "cubyz:branch":
      return true;
    case "cubyz:carpet":
      return (blockData & 0x3f) !== 0 && shape.quads.length > 0;
    case "cubyz:sign":
      return blockData < 8
        ? (shape.variantQuads.floor?.length ?? 0) > 0
        : blockData < 16
          ? (shape.variantQuads.ceiling?.length ?? 0) > 0
          : (shape.variantQuads.side?.length ?? 0) > 0;
    case "cubyz:hanging":
      return (
        ((blockData % 2 === 0
          ? shape.variantQuads.top?.length
          : shape.variantQuads.bottom?.length) ?? shape.quads.length) > 0
      );
    case "cubyz:direction":
    case "cubyz:texture_pile":
      return shape.quads.length > 0;
  }
}

export async function getEmitterOpenFaces(
  x: number,
  y: number,
  z: number,
  isTraversable: (x: number, y: number, z: number) => Promise<boolean>,
): Promise<number> {
  let mask = 0;
  if (await isTraversable(x + 1, y, z)) mask |= EMITTER_OPEN_FACE_X_POS;
  if (await isTraversable(x - 1, y, z)) mask |= EMITTER_OPEN_FACE_X_NEG;
  if (await isTraversable(x, y + 1, z)) mask |= EMITTER_OPEN_FACE_Y_POS;
  if (await isTraversable(x, y - 1, z)) mask |= EMITTER_OPEN_FACE_Y_NEG;
  if (await isTraversable(x, y, z + 1)) mask |= EMITTER_OPEN_FACE_Z_POS;
  if (await isTraversable(x, y, z - 1)) mask |= EMITTER_OPEN_FACE_Z_NEG;
  return mask;
}

function isTraversableSemantic(
  shape: BlockSemanticShape,
  data: number,
  lod: number,
): boolean {
  if (lod !== 1) return false;
  return shape.semantic !== "cubyz:stairs" || (data & 0xff) !== 0;
}

function isSemanticBoundarySolid(
  shape: BlockSemanticShape,
  data: number,
  face: VoxelFace,
  lod: number,
): boolean {
  if (lod !== 1 || shape.semantic !== "cubyz:stairs") return false;
  const removedMask = data & 0xff;
  const occupied = (x: number, y: number, z: number) =>
    (removedMask & (1 << ((x * 2 + y) * 2 + z))) === 0;
  for (let x = 0; x < 2; x++) {
    for (let y = 0; y < 2; y++) {
      for (let z = 0; z < 2; z++) {
        if (isSubBlockOnFace(x, y, z, face) && !occupied(x, y, z)) {
          return false;
        }
      }
    }
  }
  return true;
}

function isSubBlockOnFace(
  x: number,
  y: number,
  z: number,
  face: VoxelFace,
): boolean {
  switch (face) {
    case "x-":
      return x === 0;
    case "x+":
      return x === 1;
    case "y-":
      return y === 0;
    case "y+":
      return y === 1;
    case "z-":
      return z === 0;
    case "z+":
      return z === 1;
  }
}
