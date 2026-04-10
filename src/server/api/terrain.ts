/**
 * Terrain API route.
 * GET /api/terrain/:lod/:x/:y - Returns height + color data for 3D terrain mesh.
 */

import { Router, type Request, type Response } from "express";
import { join } from "path";
import { existsSync, statSync } from "fs";
import { parseSurfaceFile, MAP_SIZE } from "../parsers/surface.js";
import { buildTerrainData } from "../services/terrain-data.js";
import type { ColorMapService } from "../services/color-map.js";
import { logger } from "../services/logger.js";

const VALID_LODS = [1, 2, 4, 8, 16, 32];

function etagMatches(ifNoneMatch: string | string[] | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  const value = Array.isArray(ifNoneMatch) ? ifNoneMatch.join(",") : ifNoneMatch;
  const tags = value.split(",").map((tag) => tag.trim());
  return tags.includes("*") || tags.includes(etag);
}

export function createTerrainRouter(
  savePath: string,
  colorMap: ColorMapService
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

      const surfaceStat = statSync(surfacePath);
      const etag = `"terrain-${lod}-${worldX}-${worldY}-${Math.trunc(surfaceStat.mtimeMs)}-${surfaceStat.size}"`;
      if (etagMatches(req.headers["if-none-match"], etag)) {
        res.set("Cache-Control", "public, max-age=0, must-revalidate");
        res.set("ETag", etag);
        res.status(304).end();
        return;
      }

      const surface = await parseSurfaceFile(
        surfacePath,
        worldX,
        worldY,
        lod
      );
      const terrainData = buildTerrainData(surface, colorMap, 128);

      res.set("Cache-Control", "public, max-age=0, must-revalidate");
      res.set("ETag", etag);
      res.json(terrainData);
    } catch (e) {
      logger.error("Terrain data error", { error: e instanceof Error ? e.message : String(e) });
      res.status(500).json({ error: "Failed to generate terrain data" });
    }
  });

  return router;
}
