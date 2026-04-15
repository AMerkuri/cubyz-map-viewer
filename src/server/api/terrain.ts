/**
 * Terrain API route.
 * GET /api/terrain/:lod/:x/:y - Returns height + color data for 3D terrain mesh.
 */

import { createHash } from "node:crypto";
import { join } from "node:path";
import { type Request, type Response, Router } from "express";
import { MAP_SIZE, parseSurfaceFile } from "../parsers/surface.js";
import type { ColorMapService } from "../services/color-map.js";
import {
  buildTerrainData,
  DEFAULT_TERRAIN_CELL_RESOLUTION,
} from "../services/terrain-data.js";
import { NotFoundError } from "./errors.js";
import { etagMatches, statIfExists } from "./http.js";
import { parseTileParams } from "./validation.js";

const TERRAIN_CACHE_CONTROL = "public, max-age=3600";

export function createTerrainRouter(
  savePath: string,
  colorMap: ColorMapService,
): Router {
  const router = Router();

  router.get("/:lod/:x/:y", async (req: Request, res: Response) => {
    const { lod, x, y } = parseTileParams(req.params);

    const worldX = x * MAP_SIZE * lod;
    const worldY = y * MAP_SIZE * lod;
    const neighborhood = await loadTerrainNeighborhood({
      savePath,
      lod,
      tileX: x,
      tileY: y,
    });

    if (!neighborhood.centerSurface) {
      throw new NotFoundError("Surface data not found");
    }

    const etag = buildTerrainNeighborhoodEtag({
      lod,
      worldX,
      worldY,
      surfaceStats: neighborhood.surfaceStats,
      resolution: DEFAULT_TERRAIN_CELL_RESOLUTION,
    });
    if (etagMatches(req.headers["if-none-match"], etag)) {
      res.set("Cache-Control", TERRAIN_CACHE_CONTROL);
      res.set("ETag", etag);
      res.status(304).end();
      return;
    }

    const terrainData = buildTerrainData({
      centerTileX: x,
      centerTileY: y,
      surfaces: neighborhood.surfaces,
      colorMap,
      resolution: DEFAULT_TERRAIN_CELL_RESOLUTION,
    });

    res.set("Cache-Control", TERRAIN_CACHE_CONTROL);
    res.set("ETag", etag);
    res.json(terrainData);
  });

  return router;
}

async function loadTerrainNeighborhood(args: {
  savePath: string;
  lod: number;
  tileX: number;
  tileY: number;
}): Promise<{
  surfaces: Map<string, Awaited<ReturnType<typeof parseSurfaceFile>>>;
  surfaceStats: Map<
    string,
    NonNullable<Awaited<ReturnType<typeof statIfExists>>>
  >;
  centerSurface: Awaited<ReturnType<typeof parseSurfaceFile>> | null;
}> {
  const { savePath, lod, tileX, tileY } = args;
  const surfaces = new Map<
    string,
    Awaited<ReturnType<typeof parseSurfaceFile>>
  >();
  const surfaceStats = new Map<
    string,
    NonNullable<Awaited<ReturnType<typeof statIfExists>>>
  >();

  for (let offsetX = -1; offsetX <= 1; offsetX++) {
    for (let offsetY = -1; offsetY <= 1; offsetY++) {
      const neighborTileX = tileX + offsetX;
      const neighborTileY = tileY + offsetY;
      const neighborWorldX = neighborTileX * MAP_SIZE * lod;
      const neighborWorldY = neighborTileY * MAP_SIZE * lod;
      const surfacePath = join(
        savePath,
        "maps",
        String(lod),
        String(neighborWorldX),
        `${neighborWorldY}.surface`,
      );

      const surfaceStat = await statIfExists(surfacePath);
      if (!surfaceStat) {
        continue;
      }

      const key = terrainSurfaceKey(neighborTileX, neighborTileY);
      surfaceStats.set(key, surfaceStat);
      surfaces.set(
        key,
        await parseSurfaceFile(
          surfacePath,
          neighborWorldX,
          neighborWorldY,
          lod,
        ),
      );
    }
  }

  return {
    surfaces,
    surfaceStats,
    centerSurface: surfaces.get(terrainSurfaceKey(tileX, tileY)) ?? null,
  };
}

function terrainSurfaceKey(tileX: number, tileY: number): string {
  return `${tileX}/${tileY}`;
}

function buildTerrainNeighborhoodEtag(args: {
  lod: number;
  worldX: number;
  worldY: number;
  surfaceStats: Map<
    string,
    NonNullable<Awaited<ReturnType<typeof statIfExists>>>
  >;
  resolution: number;
}): string {
  const { lod, worldX, worldY, surfaceStats, resolution } = args;
  const hash = createHash("sha1");
  const keys = [...surfaceStats.keys()].sort();
  for (const key of keys) {
    const stats = surfaceStats.get(key);
    if (!stats) continue;
    hash.update(`${key}:${Math.trunc(stats.mtimeMs)}:${stats.size}|`);
  }

  return `"terrain-${lod}-${worldX}-${worldY}-${resolution}-${hash.digest("hex")}"`;
}
