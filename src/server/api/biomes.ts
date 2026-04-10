/**
 * Biomes API route.
 * GET /api/biomes/:lod/:x/:y - Returns biome regions for a surface tile.
 * Each region includes the biome name, centroid position, and cell count.
 */

import { Router, type Request, type Response } from "express";
import { join } from "path";
import { existsSync } from "fs";
import { parseSurfaceFile, MAP_SIZE } from "../parsers/surface.js";
import type { Palette } from "../parsers/palette.js";
import { logger } from "../services/logger.js";

const VALID_LODS = [1, 2, 4, 8, 16, 32];

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
  biomePalette: Palette
): Router {
  const router = Router();

  router.get("/:lod/:x/:y", async (req: Request, res: Response) => {
    try {
      const lod = parseInt(req.params.lod as string);
      const x = parseInt(req.params.x as string);
      const y = parseInt(req.params.y as string);

      if (!VALID_LODS.includes(lod) || isNaN(x) || isNaN(y)) {
        res.status(400).json({ error: "Invalid parameters" });
        return;
      }

      const worldX = x * MAP_SIZE * lod;
      const worldY = y * MAP_SIZE * lod;
      const surfacePath = join(
        savePath,
        "maps",
        String(lod),
        String(worldX),
        `${worldY}.surface`
      );

      if (!existsSync(surfacePath)) {
        res.status(404).json({ error: "Surface data not found" });
        return;
      }

      const surface = await parseSurfaceFile(surfacePath, worldX, worldY, lod);
      const regions = extractBiomeRegions(surface.biomes, worldX, worldY, lod, biomePalette);

      res.set("Cache-Control", "public, max-age=60");
      res.json({ tileX: x, tileY: y, lod, regions });
    } catch (e) {
      logger.error("Biome data error", { error: e instanceof Error ? e.message : String(e) });
      res.status(500).json({ error: "Failed to extract biome data" });
    }
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
  biomePalette: Palette
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
