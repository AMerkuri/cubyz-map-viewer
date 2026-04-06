/**
 * World API route.
 * GET /api/world - Returns world metadata.
 * GET /api/world/surface-index - Returns list of all available surface files.
 */

import { Router, type Request, type Response } from "express";
import { join } from "path";
import { readdir, stat } from "fs/promises";
import type { WorldMetadata } from "../parsers/world-meta.js";
import { MAP_SIZE } from "../parsers/surface.js";

export interface SurfaceIndex {
  lod: number;
  worldX: number;
  worldY: number;
  tileX: number;
  tileY: number;
}

export function createWorldRouter(
  savePath: string,
  worldMeta: WorldMetadata
): Router {
  const router = Router();

  router.get("/", (_req: Request, res: Response) => {
    res.json(worldMeta);
  });

  router.get("/surface-index", async (_req: Request, res: Response) => {
    try {
      const index = await buildSurfaceIndex(savePath);
      res.json(index);
    } catch (e) {
      console.error(`Surface index error: ${e}`);
      res.json([]);
    }
  });

  return router;
}

async function buildSurfaceIndex(savePath: string): Promise<SurfaceIndex[]> {
  const mapsDir = join(savePath, "maps");
  const index: SurfaceIndex[] = [];

  let lodDirs: string[];
  try {
    lodDirs = await readdir(mapsDir);
  } catch {
    return index;
  }

  for (const lodStr of lodDirs) {
    const lod = parseInt(lodStr);
    if (isNaN(lod)) continue;

    const lodPath = join(mapsDir, lodStr);
    const lodStat = await stat(lodPath).catch(() => null);
    if (!lodStat?.isDirectory()) continue;

    const wxDirs = await readdir(lodPath).catch(() => [] as string[]);
    for (const wxStr of wxDirs) {
      const worldX = parseInt(wxStr);
      if (isNaN(worldX)) continue;

      const wxPath = join(lodPath, wxStr);
      const wxStat = await stat(wxPath).catch(() => null);
      if (!wxStat?.isDirectory()) continue;

      const files = await readdir(wxPath).catch(() => [] as string[]);
      for (const file of files) {
        if (!file.endsWith(".surface")) continue;
        const worldY = parseInt(file);
        if (isNaN(worldY)) continue;

        index.push({
          lod,
          worldX,
          worldY,
          tileX: worldX / (MAP_SIZE * lod),
          tileY: worldY / (MAP_SIZE * lod),
        });
      }
    }
  }

  return index;
}
