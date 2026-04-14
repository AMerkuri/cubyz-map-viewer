/**
 * Voxels API route.
 * GET /api/voxels/:lod/:regionX/:regionY
 */

import { type Request, type Response, Router } from "express";
import { logger } from "../services/logger.js";
import type {
  VoxelContentEncoding,
  VoxelMeshService,
} from "../services/voxel-mesh-service.js";
import { etagMatches } from "./http.js";
import { assertAlignedRegion, parseRegionParams } from "./validation.js";

const VOXEL_CACHE_CONTROL = "public, max-age=0, must-revalidate";
const VOXEL_MISS_CACHE_CONTROL = "no-store";

type NegotiatedVoxelEncoding = Exclude<VoxelContentEncoding, "identity">;

function encodingPreference(encoding: VoxelContentEncoding): number {
  switch (encoding) {
    case "br":
      return 1;
    case "gzip":
      return 0;
    case "identity":
      return -1;
  }
}

function pickVoxelEncoding(
  acceptEncoding: string | undefined,
): NegotiatedVoxelEncoding | null {
  if (!acceptEncoding) return null;
  const entries = acceptEncoding
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const supported = new Set<NegotiatedVoxelEncoding>(["br", "gzip"]);
  let best: {
    encoding: NegotiatedVoxelEncoding;
    quality: number;
    order: number;
  } | null = null;

  for (const [order, entry] of entries.entries()) {
    const [token, ...params] = entry.split(";").map((part) => part.trim());
    if (!token) continue;
    let quality = 1;
    for (const param of params) {
      const [name, rawValue] = param.split("=").map((part) => part.trim());
      if (name !== "q" || !rawValue) continue;
      const parsed = Number(rawValue);
      quality = Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0;
    }
    const candidates: NegotiatedVoxelEncoding[] =
      token === "*"
        ? ["br", "gzip"]
        : supported.has(token as NegotiatedVoxelEncoding)
          ? [token as NegotiatedVoxelEncoding]
          : [];
    for (const encoding of candidates) {
      if (quality <= 0) continue;
      if (
        !best ||
        quality > best.quality ||
        (quality === best.quality &&
          (encodingPreference(encoding) > encodingPreference(best.encoding) ||
            (encodingPreference(encoding) ===
              encodingPreference(best.encoding) &&
              order < best.order)))
      ) {
        best = { encoding, quality, order };
      }
    }
  }

  return best?.encoding ?? null;
}

export function createVoxelsRouter(voxelMeshService: VoxelMeshService): Router {
  const router = Router();

  router.get("/metrics", async (req: Request, res: Response) => {
    const lod = req.query.lod ? Number(req.query.lod) : null;
    const regionX = req.query.regionX ? Number(req.query.regionX) : null;
    const regionY = req.query.regionY ? Number(req.query.regionY) : null;
    const fresh = req.query.fresh === "1" || req.query.fresh === "true";

    if (lod !== null || regionX !== null || regionY !== null) {
      if (
        lod === null ||
        regionX === null ||
        regionY === null ||
        !Number.isFinite(lod) ||
        !Number.isFinite(regionX) ||
        !Number.isFinite(regionY)
      ) {
        res.status(400).json({
          error: "lod, regionX, and regionY query params are required together",
        });
        return;
      }

      assertAlignedRegion(lod, regionX, regionY);
      const key = `${lod}/${regionX}/${regionY}`;
      const benchmark = await voxelMeshService.benchmarkVoxelMesh(
        key,
        lod,
        regionX,
        regionY,
        fresh,
      );
      if (!benchmark) {
        res.status(204).end();
        return;
      }
      res.json(benchmark);
      return;
    }

    res.json(voxelMeshService.getMetricsSnapshot());
  });

  router.get("/:lod/:regionX/:regionY", async (req: Request, res: Response) => {
    const { lod, regionX, regionY } = parseRegionParams(req.params);
    assertAlignedRegion(lod, regionX, regionY);

    const key = `${lod}/${regionX}/${regionY}`;
    const contentEncoding = pickVoxelEncoding(req.get("accept-encoding"));
    if (!contentEncoding) {
      res.status(406).json({
        error: "Voxel responses require br or gzip Accept-Encoding support",
      });
      return;
    }

    const currentEtag = await voxelMeshService.getCurrentEtag(
      key,
      lod,
      regionX,
      regionY,
      contentEncoding,
    );
    if (!currentEtag) {
      res.set("Cache-Control", VOXEL_MISS_CACHE_CONTROL);
      res.status(204).end();
      return;
    }
    if (etagMatches(req.headers["if-none-match"], currentEtag)) {
      res.set("Cache-Control", VOXEL_CACHE_CONTROL);
      res.append("Vary", "Accept-Encoding");
      res.set("ETag", currentEtag);
      res.status(304).end();
      return;
    }

    const response = await voxelMeshService.getVoxelMesh(
      key,
      lod,
      regionX,
      regionY,
      contentEncoding,
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
    res.append("Vary", "Accept-Encoding");
    res.set("ETag", response.etag);

    res.set("Content-Type", "application/octet-stream");
    if (response.contentEncoding) {
      res.set("Content-Encoding", response.contentEncoding);
    }
    res.send(response.buf);
  });

  return router;
}
