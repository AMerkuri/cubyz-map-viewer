/**
 * Biomes API route.
 * GET /api/biomes/:lod/:x/:y - Returns biome regions for a surface tile.
 * Each region includes the biome name, centroid position, and cell count.
 */

import { join } from "node:path";
import { type Request, type Response, Router } from "express";
import type { Palette } from "../parsers/palette.js";
import { MAP_SIZE, parseSurfaceFile } from "../parsers/surface.js";
import { NotFoundError } from "./errors.js";
import { etagMatches, statIfExists } from "./http.js";
import { parseTileParams } from "./validation.js";

const BIOMES_CACHE_CONTROL = "public, max-age=3600";

interface BiomeRegion {
  biomeId: string;
  biomeName: string;
  /** World X of the biome centroid */
  centerX: number;
  /** World Y of the biome centroid */
  centerY: number;
  /** Number of cells this biome covers in the tile */
  count: number;
}

export function createBiomesRouter(
  savePath: string,
  biomePalette: Palette,
): Router {
  const router = Router();

  router.get("/:lod/:x/:y", async (req: Request, res: Response) => {
    const { lod, x, y } = parseTileParams(req.params);

    const worldX = x * MAP_SIZE * lod;
    const worldY = y * MAP_SIZE * lod;
    const surfacePath = join(
      savePath,
      "maps",
      String(lod),
      String(worldX),
      `${worldY}.surface`,
    );

    const surfaceStat = await statIfExists(surfacePath);
    if (!surfaceStat) {
      throw new NotFoundError("Surface data not found");
    }

    const etag = `"biomes-${lod}-${worldX}-${worldY}-${Math.trunc(surfaceStat.mtimeMs)}-${surfaceStat.size}"`;
    if (etagMatches(req.headers["if-none-match"], etag)) {
      res.set("Cache-Control", BIOMES_CACHE_CONTROL);
      res.set("ETag", etag);
      res.status(304).end();
      return;
    }

    const surface = await parseSurfaceFile(surfacePath, worldX, worldY, lod);
    const regions = extractBiomeRegions(
      surface.biomes,
      worldX,
      worldY,
      lod,
      biomePalette,
    );

    res.set("Cache-Control", BIOMES_CACHE_CONTROL);
    res.set("ETag", etag);
    res.json({ tileX: x, tileY: y, lod, regions });
  });

  return router;
}

/**
 * Extract biome regions from surface biome data.
 * Groups adjacent cells by biome index, computes centroids.
 */
function extractBiomeRegions(
  biomes: Uint32Array,
  worldX: number,
  worldY: number,
  lod: number,
  biomePalette: Palette,
): BiomeRegion[] {
  // Accumulate per-biome: sum of positions and count
  const biomeAccum = new Map<
    number,
    { sumX: number; sumY: number; count: number }
  >();

  for (let sx = 0; sx < MAP_SIZE; sx++) {
    for (let sy = 0; sy < MAP_SIZE; sy++) {
      const idx = sx * MAP_SIZE + sy;
      const biomeIdx = biomes[idx];

      let accum = biomeAccum.get(biomeIdx);
      if (!accum) {
        accum = { sumX: 0, sumY: 0, count: 0 };
        biomeAccum.set(biomeIdx, accum);
      }

      // Convert tile-local coordinates to world coordinates
      accum.sumX += worldX + sx * lod;
      accum.sumY += worldY + sy * lod;
      accum.count++;
    }
  }

  const regions: BiomeRegion[] = [];

  for (const [biomeIdx, accum] of biomeAccum) {
    const biomeId = biomePalette.entries[biomeIdx];
    if (!biomeId) continue;

    regions.push({
      biomeId,
      biomeName: biomeId,
      centerX: accum.sumX / accum.count,
      centerY: accum.sumY / accum.count,
      count: accum.count,
    });
  }

  // Sort by count descending (largest biomes first)
  regions.sort((a, b) => b.count - a.count);

  return regions;
}
