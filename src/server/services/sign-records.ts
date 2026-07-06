/**
 * Sign record generation.
 *
 * Joins the raw block-entity records recovered by the region parser with the
 * block palette + shape table so we can emit, per region column, a record for
 * every sign block that carries text. Each record contains the sign's world
 * position, orientation `data` (0-19), the decoded UTF-8 text, and the four
 * world-space corners of the text plane (coplanar with the sign board).
 *
 * The corner math mirrors the sign geometry used by `getSignQuads()` in
 * `voxel-generator.ts`: the front face of the board for each variant is defined
 * in local block space, then rotated/transformed identically before being
 * translated into world coordinates. Coordinate convention is X/Y horizontal,
 * Z vertical.
 */

import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  CHUNK_SIZE,
  type ChunkData,
  parseRegionFile,
} from "../parsers/region.js";
import {
  type BlockShape,
  type BlockShapeTable,
  resolveShapeForLod,
} from "./block-shape-table.js";
import { logger } from "./logger.js";

/** Sign text is LOD-gated to the finest detail level. */
const SIGN_RECORD_LOD = 1;

export interface SignRecordCorner {
  x: number;
  y: number;
  z: number;
}

export interface SignRecord {
  /** World position of the sign block (block minimum corner). */
  position: SignRecordCorner;
  /** Orientation data value (0-19). */
  data: number;
  /** Decoded UTF-8 sign text; newlines preserved verbatim. */
  text: string;
  /** Four world-space corners of the sign's text plane, in order. */
  corners: [
    SignRecordCorner,
    SignRecordCorner,
    SignRecordCorner,
    SignRecordCorner,
  ];
}

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

/**
 * Generate sign records for a region column at the sign LOD.
 *
 * Iterates every `.region` file stacked in Z inside the column directory,
 * decodes the block-entity records already parsed alongside the block array,
 * and joins them with the block palette + shape table to produce sign records.
 */
export async function generateSignRecords(
  savePath: string,
  blockShapes: BlockShapeTable,
  lod: number,
  regionX: number,
  regionY: number,
): Promise<SignRecord[]> {
  if (lod !== SIGN_RECORD_LOD) return [];

  const colDir = join(
    savePath,
    "chunks",
    String(lod),
    String(regionX),
    String(regionY),
  );
  if (!existsSync(colDir)) return [];

  let entries: string[];
  try {
    entries = await readdir(colDir);
  } catch {
    return [];
  }

  const zValues = entries
    .filter((entry) => entry.endsWith(".region"))
    .map((entry) => parseInt(entry.slice(0, -".region".length), 10))
    .filter((value) => !Number.isNaN(value));

  const records: SignRecord[] = [];

  for (const regionWorldZ of zValues) {
    const path = join(colDir, `${regionWorldZ}.region`);
    let region: Awaited<ReturnType<typeof parseRegionFile>>;
    try {
      region = await parseRegionFile(path, regionX, regionY, regionWorldZ, lod);
    } catch (error) {
      logger.warn("Failed to parse region for sign records", {
        path,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    for (const chunk of region.chunks) {
      if (!chunk || chunk.entities.length === 0) continue;
      collectChunkSignRecords(
        chunk,
        blockShapes,
        lod,
        regionX,
        regionY,
        regionWorldZ,
        records,
      );
    }
  }

  return records;
}

function collectChunkSignRecords(
  chunk: ChunkData,
  blockShapes: BlockShapeTable,
  lod: number,
  regionX: number,
  regionY: number,
  regionWorldZ: number,
  out: SignRecord[],
): void {
  for (const entity of chunk.entities) {
    const index = entity.positionIndex;
    // u15 packed as (x << 10) | (y << 5) | z within the 32^3 chunk.
    const lx = (index >> 10) & 0x1f;
    const ly = (index >> 5) & 0x1f;
    const lz = index & 0x1f;
    const localIdx = lx * CHUNK_SIZE * CHUNK_SIZE + ly * CHUNK_SIZE + lz;
    const blockValue = chunk.blocks[localIdx] ?? 0;
    const paletteIndex = blockValue & 0xffff;
    const data = blockValue >>> 16;

    const shape = resolveShapeForLod(blockShapes, paletteIndex, lod);
    if (!isSignShape(shape)) continue;

    let text: string;
    try {
      text = utf8Decoder.decode(entity.payload);
    } catch {
      // Invalid UTF-8: skip this record without producing a sign entry.
      continue;
    }
    if (text.length === 0) continue;

    const worldX = regionX + (chunk.rx * CHUNK_SIZE + lx) * lod;
    const worldY = regionY + (chunk.ry * CHUNK_SIZE + ly) * lod;
    const worldZ = regionWorldZ + (chunk.rz * CHUNK_SIZE + lz) * lod;

    out.push({
      position: { x: worldX, y: worldY, z: worldZ },
      data,
      text,
      corners: computeTextPlaneCorners(data, worldX, worldY, worldZ, lod),
    });
  }
}

function isSignShape(shape: BlockShape): boolean {
  return shape.kind === "semantic" && shape.semantic === "cubyz:sign";
}

interface LocalVertex {
  x: number;
  y: number;
  z: number;
}

// Local-space text-plane corners (before rotation) for each sign variant. These
// mirror the front (outward) face of the board geometry in the sign OBJ models:
//   floor:   board x∈[0.469,0.531], y∈[0,1], z∈[0.4375,1]   → front face +X
//   ceiling: board x∈[0.469,0.531], y∈[0,1], z∈[0,0.5625]   → front face +X
//   side:    board x∈[0,0.0625],   y∈[0,1], z∈[0.25,0.8125] → front face +X
const FLOOR_TEXT_PLANE: LocalVertex[] = makeXPlane(0.53125, 0, 1, 0.4375, 1);
const CEILING_TEXT_PLANE: LocalVertex[] = makeXPlane(0.53125, 0, 1, 0, 0.5625);
const SIDE_TEXT_PLANE: LocalVertex[] = makeXPlane(0.0625, 0, 1, 0.25, 0.8125);

// Build a quad on a constant-X plane, corners ordered
// (yMin,zMin) → (yMax,zMin) → (yMax,zMax) → (yMin,zMax).
function makeXPlane(
  x: number,
  yMin: number,
  yMax: number,
  zMin: number,
  zMax: number,
): LocalVertex[] {
  return [
    { x, y: yMin, z: zMin },
    { x, y: yMax, z: zMin },
    { x, y: yMax, z: zMax },
    { x, y: yMin, z: zMax },
  ];
}

function computeTextPlaneCorners(
  data: number,
  worldX: number,
  worldY: number,
  worldZ: number,
  lod: number,
): [SignRecordCorner, SignRecordCorner, SignRecordCorner, SignRecordCorner] {
  let plane: LocalVertex[];
  let ceiling = false;
  let eighths: number;

  if (data < 8) {
    plane = FLOOR_TEXT_PLANE;
    eighths = data & 7;
  } else if (data < 16) {
    plane = CEILING_TEXT_PLANE;
    ceiling = true;
    eighths = data & 7;
  } else {
    plane = SIDE_TEXT_PLANE;
    eighths = ((data - 16) & 3) * 2;
  }

  const corners = plane.map((vertex) => {
    const local = transformSignVertex(vertex, ceiling, eighths);
    return {
      x: worldX + local.x * lod,
      y: worldY + local.y * lod,
      z: worldZ + local.z * lod,
    };
  });

  return corners as [
    SignRecordCorner,
    SignRecordCorner,
    SignRecordCorner,
    SignRecordCorner,
  ];
}

// Replicates `transformModelVertex` in voxel-generator.ts for the sign cases:
// the ceiling variant applies {x, 1-y, 1-z}, and both variants rotate about the
// block's vertical (Z) axis through its center in 45-degree `eighths` steps.
function transformSignVertex(
  vertex: LocalVertex,
  ceiling: boolean,
  eighths: number,
): LocalVertex {
  const rotated = rotateEighthsAboutCenter(vertex, eighths);
  if (!ceiling) return rotated;
  return { x: rotated.x, y: 1 - rotated.y, z: 1 - rotated.z };
}

function rotateEighthsAboutCenter(
  vertex: LocalVertex,
  eighths: number,
): LocalVertex {
  const steps = ((eighths % 8) + 8) % 8;
  if (steps === 0) return vertex;
  const angle = (steps * Math.PI) / 4;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const cx = vertex.x - 0.5;
  const cy = vertex.y - 0.5;
  return {
    x: cx * cos - cy * sin + 0.5,
    y: cx * sin + cy * cos + 0.5,
    z: vertex.z,
  };
}
