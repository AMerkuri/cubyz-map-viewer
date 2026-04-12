/**
 * World API route.
 * GET /api/world - Returns world metadata.
 * GET /api/world/surface-index - Returns list of all available surface files.
 * GET /api/world/chunk-index - Returns list of available voxel region columns.
 */

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { type Request, type Response, Router } from "express";
import { MAP_SIZE } from "../parsers/surface.js";
import type { WorldMetadata } from "../parsers/world-meta.js";
import { isNodeErrorWithCode } from "./errors.js";

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
    const index = await buildSurfaceIndex(savePath);
    res.json(index);
  });

  router.get("/chunk-index", async (_req: Request, res: Response) => {
    const index = await buildChunkIndex(savePath);
    res.json(index);
  });

  return router;
}

async function buildSurfaceIndex(savePath: string): Promise<SurfaceIndex[]> {
  const mapsDir = join(savePath, "maps");
  const index: SurfaceIndex[] = [];

  let lodDirs: string[];
  try {
    lodDirs = await readdir(mapsDir);
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT") {
      return index;
    }
    throw error;
  }

  for (const lodStr of lodDirs) {
    const lod = parseInt(lodStr, 10);
    if (Number.isNaN(lod)) continue;

    const lodPath = join(mapsDir, lodStr);
    const lodStat = await stat(lodPath);
    if (!lodStat.isDirectory()) continue;

    const wxDirs = await readdir(lodPath);
    for (const wxStr of wxDirs) {
      const worldX = parseInt(wxStr, 10);
      if (Number.isNaN(worldX)) continue;

      const wxPath = join(lodPath, wxStr);
      const wxStat = await stat(wxPath);
      if (!wxStat.isDirectory()) continue;

      const files = await readdir(wxPath);
      for (const file of files) {
        if (!file.endsWith(".surface")) continue;
        const worldY = parseInt(file, 10);
        if (Number.isNaN(worldY)) continue;

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
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT") {
      return index;
    }
    throw error;
  }

  for (const lodStr of lodDirs) {
    const lod = parseInt(lodStr, 10);
    if (Number.isNaN(lod) || lod <= 0) continue;

    const lodPath = join(chunksDir, lodStr);
    const lodStat = await stat(lodPath);
    if (!lodStat.isDirectory()) continue;

    const rxDirs = await readdir(lodPath);
    for (const rxStr of rxDirs) {
      const regionX = parseInt(rxStr, 10);
      if (Number.isNaN(regionX)) continue;

      const rxPath = join(lodPath, rxStr);
      const rxStat = await stat(rxPath);
      if (!rxStat.isDirectory()) continue;

      const ryDirs = await readdir(rxPath);
      for (const ryStr of ryDirs) {
        const regionY = parseInt(ryStr, 10);
        if (Number.isNaN(regionY)) continue;

        const ryPath = join(rxPath, ryStr);
        const ryStat = await stat(ryPath);
        if (!ryStat.isDirectory()) continue;

        const files = await readdir(ryPath);
        if (!files.some((f) => f.endsWith(".region"))) continue;

        index.push({ lod, regionX, regionY });
      }
    }
  }

  index.sort(
    (a, b) => a.lod - b.lod || a.regionX - b.regionX || a.regionY - b.regionY,
  );
  return index;
}
