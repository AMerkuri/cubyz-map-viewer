/**
 * Tiles API route.
 * GET /api/tiles/:lod/:x/:y.png - Returns a 256x256 PNG tile.
 */

import { Router, type Request, type Response } from "express";
import { join } from "path";
import { existsSync, statSync } from "fs";
import { parseSurfaceFile, MAP_SIZE } from "../parsers/surface.js";
import {
  renderSurfaceTile,
  renderEmptyTile,
} from "../services/tile-renderer.js";
import type { ColorMapService } from "../services/color-map.js";
import { WATER_COLOR } from "../services/color-map.js";
import type { LRUCache } from "../services/cache.js";
import { logger } from "../services/logger.js";

const VALID_LODS = [1, 2, 4, 8, 16, 32];

interface CachedTile {
  buf: Buffer;
  mtime: number; // mtime of the source surface file at render time
}

export function createTilesRouter(
  savePath: string,
  colorMap: ColorMapService,
  tileCache: LRUCache<string, CachedTile>
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
    try {
      const lod = parseInt(req.params.lod as string);
      const x = parseInt(req.params.x as string);
      const y = parseInt(req.params.y as string);

      if (!VALID_LODS.includes(lod) || isNaN(x) || isNaN(y)) {
        res.status(400).send("Invalid tile parameters");
        return;
      }

      // Map tile x,y to surface file coordinates
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
        // Return empty tile for unexplored areas (don't cache these —
        // the area might be explored soon)
        const empty = await getEmptyTile();
        res.set("Content-Type", "image/png");
        res.set("Cache-Control", "no-cache");
        res.send(empty);
        return;
      }

      // Check file modification time for cache invalidation
      const fileMtime = statSync(surfacePath).mtimeMs;
      const cacheKey = `${lod}/${x}/${y}`;
      const cached = tileCache.get(cacheKey);

      if (cached && cached.mtime === fileMtime) {
        res.set("Content-Type", "image/png");
        res.set("Cache-Control", "public, max-age=10");
        res.send(cached.buf);
        return;
      }

      const surface = await parseSurfaceFile(
        surfacePath,
        worldX,
        worldY,
        lod
      );
      const tileBuf = await renderSurfaceTile(surface, colorMap);

      tileCache.set(cacheKey, { buf: tileBuf, mtime: fileMtime });

      res.set("Content-Type", "image/png");
      res.set("Cache-Control", "public, max-age=10");
      res.send(tileBuf);
    } catch (e) {
      logger.error("Tile render error", { error: e instanceof Error ? e.message : String(e) });
      const empty = await getEmptyTile();
      res.set("Content-Type", "image/png");
      res.send(empty);
    }
  });

  return router;
}
