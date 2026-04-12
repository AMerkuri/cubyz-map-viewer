/**
 * Terrain API route.
 * GET /api/terrain/:lod/:x/:y - Returns height + color data for 3D terrain mesh.
 */

import { join } from "node:path";
import { type Request, type Response, Router } from "express";
import { MAP_SIZE, parseSurfaceFile } from "../parsers/surface.js";
import type { ColorMapService } from "../services/color-map.js";
import { buildTerrainData } from "../services/terrain-data.js";
import { NotFoundError } from "./errors.js";
import { etagMatches, statIfExists } from "./http.js";
import { parseTileParams } from "./validation.js";

export function createTerrainRouter(
  savePath: string,
  colorMap: ColorMapService,
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

    const etag = `"terrain-${lod}-${worldX}-${worldY}-${Math.trunc(surfaceStat.mtimeMs)}-${surfaceStat.size}"`;
    if (etagMatches(req.headers["if-none-match"], etag)) {
      res.set("Cache-Control", "public, max-age=0, must-revalidate");
      res.set("ETag", etag);
      res.status(304).end();
      return;
    }

    const surface = await parseSurfaceFile(surfacePath, worldX, worldY, lod);
    const terrainData = buildTerrainData(surface, colorMap, 128);

    res.set("Cache-Control", "public, max-age=0, must-revalidate");
    res.set("ETag", etag);
    res.json(terrainData);
  });

  return router;
}
