/**
 * Tiles API route.
 * GET /api/tiles/:lod/:x/:y.png - Returns a 256x256 PNG tile.
 */

import { join } from "node:path";
import { type Request, type Response, Router } from "express";
import { MAP_SIZE, parseSurfaceFile } from "../parsers/surface.js";
import type { LRUCache } from "../services/cache.js";
import type { ColorMapService } from "../services/color-map.js";
import {
  renderEmptyTile,
  renderSurfaceTile,
} from "../services/tile-renderer.js";
import { statIfExists } from "./http.js";
import { parseTileParams } from "./validation.js";

interface CachedTile {
  buf: Buffer;
  mtime: number; // mtime of the source surface file at render time
}

export function createTilesRouter(
  savePath: string,
  colorMap: ColorMapService,
  tileCache: LRUCache<string, CachedTile>,
): Router {
  const router = Router();

  // Pre-render empty tile
  let emptyTileBuf: Buffer | null = null;
  async function getEmptyTile(): Promise<Buffer> {
    if (!emptyTileBuf) {
      emptyTileBuf = await renderEmptyTile({ r: 20, g: 20, b: 30 });
    }
    return emptyTileBuf;
  }

  router.get("/:lod/:x/:y.png", async (req: Request, res: Response) => {
    const { lod, x, y } = parseTileParams(req.params);

    // Map tile x,y to surface file coordinates
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
      // Return empty tile for unexplored areas (don't cache these —
      // the area might be explored soon)
      const empty = await getEmptyTile();
      res.set("Content-Type", "image/png");
      res.set("Cache-Control", "no-cache");
      res.send(empty);
      return;
    }

    // Check file modification time for cache invalidation
    const fileMtime = surfaceStat.mtimeMs;
    const cacheKey = `${lod}/${x}/${y}`;
    const cached = tileCache.get(cacheKey);

    if (cached && cached.mtime === fileMtime) {
      res.set("Content-Type", "image/png");
      res.set("Cache-Control", "public, max-age=10");
      res.send(cached.buf);
      return;
    }

    const surface = await parseSurfaceFile(surfacePath, worldX, worldY, lod);
    const tileBuf = await renderSurfaceTile(surface, colorMap);

    tileCache.set(cacheKey, { buf: tileBuf, mtime: fileMtime });

    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "public, max-age=10");
    res.send(tileBuf);
  });

  return router;
}
