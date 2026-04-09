/**
 * World API route.
 * GET /api/world - Returns world metadata.
 * GET /api/world/surface-index - Returns list of all available surface files.
 * GET /api/world/chunk-index - Returns list of available voxel region columns.
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

export interface ChunkIndexEntry {
  lod: number;
  regionX: number;
  regionY: number;
}

export function createWorldRouter(
  savePath: string,
  worldMeta: WorldMetadata,
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

  router.get("/chunk-index", async (_req: Request, res: Response) => {
    try {
      const index = await buildChunkIndex(savePath);
      res.json(index);
    } catch (e) {
      console.error(`Chunk index error: ${e}`);
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

async function buildChunkIndex(savePath: string): Promise<ChunkIndexEntry[]> {
  const chunksDir = join(savePath, "chunks");
  const index: ChunkIndexEntry[] = [];

  let lodDirs: string[];
  try {
    lodDirs = await readdir(chunksDir);
  } catch {
    return index;
  }

  for (const lodStr of lodDirs) {
    const lod = parseInt(lodStr);
    if (isNaN(lod) || lod <= 0) continue;

    const lodPath = join(chunksDir, lodStr);
    const lodStat = await stat(lodPath).catch(() => null);
    if (!lodStat?.isDirectory()) continue;

    const rxDirs = await readdir(lodPath).catch(() => [] as string[]);
    for (const rxStr of rxDirs) {
      const regionX = parseInt(rxStr);
      if (isNaN(regionX)) continue;

      const rxPath = join(lodPath, rxStr);
      const rxStat = await stat(rxPath).catch(() => null);
      if (!rxStat?.isDirectory()) continue;

      const ryDirs = await readdir(rxPath).catch(() => [] as string[]);
      for (const ryStr of ryDirs) {
        const regionY = parseInt(ryStr);
        if (isNaN(regionY)) continue;

        const ryPath = join(rxPath, ryStr);
        const ryStat = await stat(ryPath).catch(() => null);
        if (!ryStat?.isDirectory()) continue;

        const files = await readdir(ryPath).catch(() => [] as string[]);
        if (!files.some((f) => f.endsWith(".region"))) continue;

        index.push({ lod, regionX, regionY });
      }
    }
  }

  index.sort((a, b) => a.lod - b.lod || a.regionX - b.regionX || a.regionY - b.regionY);
  return index;
}
