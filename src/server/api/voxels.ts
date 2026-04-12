/**
 * Voxels API route.
 * GET /api/voxels/:lod/:regionX/:regionY
 */

import { type Request, type Response, Router } from "express";
import { logger } from "../services/logger.js";
import type { VoxelMeshService } from "../services/voxel-mesh-service.js";
import { etagMatches } from "./http.js";
import { assertAlignedRegion, parseRegionParams } from "./validation.js";

const VOXEL_CACHE_CONTROL = "public, max-age=0, must-revalidate";
const VOXEL_MISS_CACHE_CONTROL = "no-store";

export function createVoxelsRouter(voxelMeshService: VoxelMeshService): Router {
  const router = Router();

  router.get("/metrics", (_req: Request, res: Response) => {
    res.json(voxelMeshService.getMetricsSnapshot());
  });

  router.get("/:lod/:regionX/:regionY", async (req: Request, res: Response) => {
    const { lod, regionX, regionY } = parseRegionParams(req.params);
    assertAlignedRegion(lod, regionX, regionY);

    const key = `${lod}/${regionX}/${regionY}`;
    const response = await voxelMeshService.getVoxelMesh(
      key,
      lod,
      regionX,
      regionY,
    );
    res.set("X-Voxel-Source", response.metrics.source);
    res.set("X-Voxel-Queue-Ms", response.metrics.queueMs.toFixed(1));
    res.set("X-Voxel-Run-Ms", response.metrics.runMs.toFixed(1));
    res.set("X-Voxel-Total-Ms", response.metrics.totalMs.toFixed(1));
    res.set("X-Voxel-Queue-Depth", String(response.metrics.queueDepth));
    res.set("X-Voxel-Running", String(response.metrics.runningJobs));
    res.set("X-Voxel-In-Flight", String(response.metrics.inFlightJobs));

    logger.http("voxel request completed", {
      requestId: req.requestId,
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
  });

  return router;
}
