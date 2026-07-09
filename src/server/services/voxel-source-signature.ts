import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { MAP_SIZE } from "../parsers/surface.js";
import { VOXEL_GENERATOR_CACHE_VERSION } from "./voxel-cache-version.js";

const MAX_ENTRANCE_DEPTH_WORLD = 64;
const VOXEL_REGION_SIZE = 128;
const EMITTED_LIGHT_RADIUS_CELLS = 12;

interface ColumnSignature {
  signature: string;
  zValues: number[];
}

interface SurfaceSignature {
  signature: string;
  hasSurface: boolean;
}

async function buildColumnSignature(colDir: string): Promise<ColumnSignature> {
  const entries = await readdir(colDir);
  const zValues = entries
    .filter((entry) => entry.endsWith(".region"))
    .map((entry) => parseInt(entry.slice(0, -".region".length), 10))
    .filter((value) => !Number.isNaN(value))
    .sort((a, b) => b - a);
  const hash = createHash("sha1");
  for (const worldZ of zValues) {
    const path = join(colDir, `${worldZ}.region`);
    const stats = await stat(path);
    hash.update(`${worldZ}:${Math.trunc(stats.mtimeMs)}:${stats.size}|`);
  }
  return { signature: hash.digest("hex"), zValues };
}

async function buildSurfaceSignature(
  savePath: string,
  regionX: number,
  regionY: number,
  lod: number,
): Promise<SurfaceSignature> {
  const regionSpanWorld = VOXEL_REGION_SIZE * lod;
  const hash = createHash("sha1");

  const sameTileSize = MAP_SIZE * lod;
  const sameTileX = Math.floor(regionX / sameTileSize) * sameTileSize;
  const sameTileY = Math.floor(regionY / sameTileSize) * sameTileSize;
  const samePath = join(
    savePath,
    "maps",
    String(lod),
    String(sameTileX),
    `${sameTileY}.surface`,
  );
  if (existsSync(samePath)) {
    const stats = await stat(samePath);
    hash.update(`${samePath}:${Math.trunc(stats.mtimeMs)}:${stats.size}|`);
    return {
      signature: hash.digest("hex"),
      hasSurface: true,
    };
  }

  const x0 = regionX;
  const y0 = regionY;
  const x1 = regionX + regionSpanWorld;
  const y1 = regionY + regionSpanWorld;
  const tileXStart = Math.floor(x0 / MAP_SIZE) * MAP_SIZE;
  const tileYStart = Math.floor(y0 / MAP_SIZE) * MAP_SIZE;
  const tileXEnd = Math.floor((x1 - 1) / MAP_SIZE) * MAP_SIZE;
  const tileYEnd = Math.floor((y1 - 1) / MAP_SIZE) * MAP_SIZE;

  let foundSurface = false;
  for (let tileX = tileXStart; tileX <= tileXEnd; tileX += MAP_SIZE) {
    for (let tileY = tileYStart; tileY <= tileYEnd; tileY += MAP_SIZE) {
      const path = join(
        savePath,
        "maps",
        "1",
        String(tileX),
        `${tileY}.surface`,
      );
      if (!existsSync(path)) continue;
      const stats = await stat(path);
      hash.update(`${path}:${Math.trunc(stats.mtimeMs)}:${stats.size}|`);
      foundSurface = true;
    }
  }

  return {
    signature: hash.digest("hex"),
    hasSurface: foundSurface,
  };
}

export async function computeVoxelSourceSignature(args: {
  savePath: string;
  blockShapeSignature: string;
  blockColorSignature: string;
  lod: number;
  regionX: number;
  regionY: number;
}): Promise<string | null> {
  const {
    savePath,
    blockShapeSignature,
    blockColorSignature,
    lod,
    regionX,
    regionY,
  } = args;
  const colDir = join(
    savePath,
    "chunks",
    String(lod),
    String(regionX),
    String(regionY),
  );
  if (!existsSync(colDir)) return null;

  const columnSignature = await buildColumnSignature(colDir);
  if (columnSignature.zValues.length === 0) return null;
  const haloColumnSignature =
    lod === 1
      ? await buildHaloColumnSignature(savePath, lod, regionX, regionY)
      : "";

  const surfaceSignature = await buildSurfaceSignature(
    savePath,
    regionX,
    regionY,
    lod,
  );
  if (!surfaceSignature.hasSurface) return null;

  return createHash("sha1")
    .update(
      `${VOXEL_GENERATOR_CACHE_VERSION}|${MAX_ENTRANCE_DEPTH_WORLD}|${columnSignature.signature}|${haloColumnSignature}|${surfaceSignature.signature}|${lod}|${regionX}|${regionY}`,
    )
    .update(`|${blockShapeSignature}`)
    .update(`|${blockColorSignature}`)
    .digest("hex");
}

async function buildHaloColumnSignature(
  savePath: string,
  lod: number,
  regionX: number,
  regionY: number,
): Promise<string> {
  const hash = createHash("sha1");
  const columnWorldSpan = VOXEL_REGION_SIZE * lod;
  const radius = EMITTED_LIGHT_RADIUS_CELLS * lod;
  const minX = regionX - radius;
  const maxX = regionX + columnWorldSpan - 1 + radius;
  const minY = regionY - radius;
  const maxY = regionY + columnWorldSpan - 1 + radius;
  const startX = Math.floor(minX / columnWorldSpan) * columnWorldSpan;
  const endX = Math.floor(maxX / columnWorldSpan) * columnWorldSpan;
  const startY = Math.floor(minY / columnWorldSpan) * columnWorldSpan;
  const endY = Math.floor(maxY / columnWorldSpan) * columnWorldSpan;

  for (let x = startX; x <= endX; x += columnWorldSpan) {
    for (let y = startY; y <= endY; y += columnWorldSpan) {
      if (x === regionX && y === regionY) continue;
      const path = join(savePath, "chunks", String(lod), String(x), String(y));
      if (!existsSync(path)) continue;
      const signature = await buildColumnSignature(path);
      hash.update(`${x}/${y}:${signature.signature}|`);
    }
  }

  return hash.digest("hex");
}
