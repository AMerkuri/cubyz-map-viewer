/**
 * Voxels API route.
 * GET /api/voxels/:lod/:regionX/:regionY
 */

import { Router, type Request, type Response } from "express";

import type { VoxelMeshService } from "../services/voxel-mesh-service.js";
import { logger } from "../services/logger.js";

const VALID_LODS = [1, 2, 4, 8, 16, 32];
const COLUMN_VOXELS = 128;
const VOXEL_CACHE_CONTROL = "public, max-age=0, must-revalidate";
const VOXEL_MISS_CACHE_CONTROL = "no-store";

function etagMatches(ifNoneMatch: string | string[] | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  const value = Array.isArray(ifNoneMatch) ? ifNoneMatch.join(",") : ifNoneMatch;
  const tags = value.split(",").map((tag) => tag.trim());
  return tags.includes("*") || tags.includes(etag);
}

export function createVoxelsRouter(voxelMeshService: VoxelMeshService): Router {
  const router = Router();

  router.get("/metrics", (_req: Request, res: Response) => {
    res.json(voxelMeshService.getMetricsSnapshot());
  });

  router.get("/:lod/:regionX/:regionY", async (req: Request, res: Response) => {
    try {
      const lod = parseInt(req.params.lod as string);
      const regionX = parseInt(req.params.regionX as string);
      const regionY = parseInt(req.params.regionY as string);
      const columnWorldSpan = COLUMN_VOXELS * lod;

      if (
        !VALID_LODS.includes(lod)
        || isNaN(regionX)
        || isNaN(regionY)
        || regionX % columnWorldSpan !== 0
        || regionY % columnWorldSpan !== 0
      ) {
        res.status(400).json({ error: "Invalid lod/region coordinates" });
        return;
      }

      const key = `${lod}/${regionX}/${regionY}`;
      const response = await voxelMeshService.getVoxelMesh(key, lod, regionX, regionY);
      res.set("X-Voxel-Source", response.metrics.source);
      res.set("X-Voxel-Queue-Ms", response.metrics.queueMs.toFixed(1));
      res.set("X-Voxel-Run-Ms", response.metrics.runMs.toFixed(1));
      res.set("X-Voxel-Total-Ms", response.metrics.totalMs.toFixed(1));
      res.set("X-Voxel-Queue-Depth", String(response.metrics.queueDepth));
      res.set("X-Voxel-Running", String(response.metrics.runningJobs));
      res.set("X-Voxel-In-Flight", String(response.metrics.inFlightJobs));

      logger.http("voxel request completed", {
        route: "/api/voxels/:lod/:regionX/:regionY",
        lod,
        regionX,
        regionY,
        source: response.metrics.source,
        queueMs: response.metrics.queueMs,
        runMs: response.metrics.runMs,
        totalMs: response.metrics.totalMs,
        queueDepth: response.metrics.queueDepth,
        runningJobs: response.metrics.runningJobs,
        inFlightJobs: response.metrics.inFlightJobs,
        byteLength: response.metrics.byteLength,
        cacheTier: response.metrics.cacheTier,
        quadCount: response.metrics.quadCount,
        chunkColumns: response.metrics.chunkColumns,
        regionsParsed: response.metrics.regionsParsed,
        chunksMeshed: response.metrics.chunksMeshed,
        visitedAirCells: response.metrics.visitedAirCells,
        facesBeforeMerge: response.metrics.facesBeforeMerge,
        minWorldZ: response.metrics.minWorldZ,
        maxWorldZ: response.metrics.maxWorldZ,
        status: response.status === "empty" ? 204 : 200,
      });

      if (response.status === "empty" || !response.buf || !response.etag) {
        res.set("Cache-Control", VOXEL_MISS_CACHE_CONTROL);
        res.status(204).end();
        return;
      }

      res.set("Cache-Control", VOXEL_CACHE_CONTROL);
      res.set("ETag", response.etag);
      if (etagMatches(req.headers["if-none-match"], response.etag)) {
        res.status(304).end();
        return;
      }

      res.set("Content-Type", "application/octet-stream");
      res.send(response.buf);
    } catch (e) {
      logger.error("Voxels API error", { error: e instanceof Error ? e.message : String(e) });
      res.status(500).json({ error: "Failed to generate voxel mesh" });
    }
  });

  return router;
}
