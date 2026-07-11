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

type PreferredVoxelEncoding = NegotiatedVoxelEncoding;

function parseAcceptEncoding(
  acceptEncoding: string | undefined,
): Map<NegotiatedVoxelEncoding, number> {
  const qualities = new Map<NegotiatedVoxelEncoding, number>();
  if (!acceptEncoding) {
    return qualities;
  }
  const entries = acceptEncoding
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  let wildcardQuality: number | null = null;

  for (const entry of entries) {
    const [token, ...params] = entry.split(";").map((part) => part.trim());
    if (!token) continue;
    let quality = 1;
    for (const param of params) {
      const [name, rawValue] = param.split("=").map((part) => part.trim());
      if (name !== "q" || !rawValue) continue;
      const parsed = Number(rawValue);
      quality = Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0;
    }
    if (token === "br" || token === "gzip") {
      qualities.set(token, Math.max(qualities.get(token) ?? 0, quality));
    } else if (token === "*") {
      wildcardQuality = Math.max(wildcardQuality ?? 0, quality);
    }
  }

  if (wildcardQuality !== null) {
    if (!qualities.has("br")) {
      qualities.set("br", wildcardQuality);
    }
    if (!qualities.has("gzip")) {
      qualities.set("gzip", wildcardQuality);
    }
  }

  return qualities;
}

function pickVoxelEncoding(
  acceptEncoding: string | undefined,
  preferredEncoding: PreferredVoxelEncoding,
): NegotiatedVoxelEncoding | null {
  const qualities = parseAcceptEncoding(acceptEncoding);
  const brQuality = qualities.get("br") ?? 0;
  const gzipQuality = qualities.get("gzip") ?? 0;
  const brAccepted = brQuality > 0;
  const gzipAccepted = gzipQuality > 0;

  if (!brAccepted && !gzipAccepted) {
    return null;
  }

  if (brAccepted && !gzipAccepted) {
    return "br";
  }

  if (gzipAccepted && !brAccepted) {
    return "gzip";
  }

  if (preferredEncoding === "br") {
    if (brQuality >= gzipQuality) {
      return "br";
    }
    return "gzip";
  }

  if (gzipQuality >= brQuality) {
    return "gzip";
  }
  return "br";
}

export function createVoxelsRouter(
  voxelMeshService: VoxelMeshService,
  preferredEncoding: PreferredVoxelEncoding,
): Router {
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

    // Debug-only voxel-lighting diagnostic: `halo=0` omits neighboring-region
    // halo emitter records. Diagnostic payloads use a distinct cache key so
    // they are never confused with normal cached payloads.
    const includeHaloEmitters = req.query.halo !== "0";
    const key = includeHaloEmitters
      ? `${lod}/${regionX}/${regionY}`
      : `${lod}/${regionX}/${regionY}#nohalo`;
    const contentEncoding = pickVoxelEncoding(
      req.get("accept-encoding"),
      preferredEncoding,
    );
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
      includeHaloEmitters,
    );
    res.set("X-Voxel-Source", response.metrics.source);
    res.set("X-Voxel-Cache", response.metrics.cacheOutcome);
    res.set("X-Voxel-Queue-Ms", response.metrics.queueMs.toFixed(1));
    res.set("X-Voxel-Run-Ms", response.metrics.runMs.toFixed(1));
    res.set("X-Voxel-Total-Ms", response.metrics.totalMs.toFixed(1));
    res.set("X-Voxel-Queue-Depth", String(response.metrics.queueDepth));
    res.set("X-Voxel-Running", String(response.metrics.runningJobs));
    res.set("X-Voxel-In-Flight", String(response.metrics.inFlightJobs));
    if (response.metrics.haloMs !== undefined) {
      res.set("X-Voxel-Halo-Ms", response.metrics.haloMs.toFixed(1));
    }
    if (response.metrics.cachedHaloMs !== undefined) {
      res.set(
        "X-Voxel-Cached-Halo-Ms",
        response.metrics.cachedHaloMs.toFixed(1),
      );
    }
    if (response.metrics.ownEmitterRecords !== undefined) {
      res.set(
        "X-Voxel-Own-Emitters",
        String(response.metrics.ownEmitterRecords),
      );
    }
    if (response.metrics.haloEmitterRecords !== undefined) {
      res.set(
        "X-Voxel-Halo-Emitters",
        String(response.metrics.haloEmitterRecords),
      );
    }
    if (response.metrics.aggregatedEmitterRecords !== undefined) {
      res.set(
        "X-Voxel-Aggregated-Emitters",
        String(response.metrics.aggregatedEmitterRecords),
      );
    }
    if (response.metrics.emitterMetadataBytes !== undefined) {
      res.set(
        "X-Voxel-Emitter-Metadata-Bytes",
        String(response.metrics.emitterMetadataBytes),
      );
    }
    if (response.metrics.emitterPowerMin !== undefined) {
      res.set(
        "X-Voxel-Emitter-Power-Min",
        String(response.metrics.emitterPowerMin),
      );
      res.set(
        "X-Voxel-Emitter-Power-Max",
        String(response.metrics.emitterPowerMax),
      );
      res.set(
        "X-Voxel-Emitter-Radius-Min",
        String(response.metrics.emitterRadiusMin),
      );
      res.set(
        "X-Voxel-Emitter-Radius-Max",
        String(response.metrics.emitterRadiusMax),
      );
    }
    if (response.metrics.summaryCacheOutcome !== undefined) {
      res.set("X-Voxel-Summary-Cache", response.metrics.summaryCacheOutcome);
      res.set(
        "X-Voxel-Summary-Build-Ms",
        String(response.metrics.summaryBuildMs),
      );
      res.set(
        "X-Voxel-Summary-Leaf-Parses",
        String(response.metrics.summaryLeafParses),
      );
      res.set(
        "X-Voxel-Summary-Raw-Sources",
        String(response.metrics.summaryRawSourceCount),
      );
      res.set(
        "X-Voxel-Summary-Representatives",
        String(response.metrics.summaryRetainedClusterCount),
      );
      res.set(
        "X-Voxel-Summary-Capped-Clusters",
        String(response.metrics.summaryCappedClusterCount),
      );
    }
    if (response.metrics.externalRegionParses !== undefined) {
      res.set(
        "X-Voxel-Ext-Region-Parses",
        String(response.metrics.externalRegionParses),
      );
    }
    if (response.metrics.externalRegionCacheHits !== undefined) {
      res.set(
        "X-Voxel-Ext-Region-Cache-Hits",
        String(response.metrics.externalRegionCacheHits),
      );
    }
    if (response.metrics.externalRegionMisses !== undefined) {
      res.set(
        "X-Voxel-Ext-Region-Misses",
        String(response.metrics.externalRegionMisses),
      );
    }
    if (response.metrics.externalRegionParseErrors !== undefined) {
      res.set(
        "X-Voxel-Ext-Region-Parse-Errors",
        String(response.metrics.externalRegionParseErrors),
      );
    }

    logger.http("voxel request completed", {
      requestId: req.requestId,
      route: "/api/voxels/:lod/:regionX/:regionY",
      lod,
      regionX,
      regionY,
      includeHaloEmitters,
      source: response.metrics.source,
      cacheOutcome: response.metrics.cacheOutcome,
      queueMs: response.metrics.queueMs,
      runMs: response.metrics.runMs,
      haloMs: response.metrics.haloMs,
      cachedHaloMs: response.metrics.cachedHaloMs,
      ownEmitterRecords: response.metrics.ownEmitterRecords,
      haloEmitterRecords: response.metrics.haloEmitterRecords,
      aggregatedEmitterRecords: response.metrics.aggregatedEmitterRecords,
      emitterMetadataBytes: response.metrics.emitterMetadataBytes,
      emitterPowerMin: response.metrics.emitterPowerMin,
      emitterPowerMax: response.metrics.emitterPowerMax,
      emitterRadiusMin: response.metrics.emitterRadiusMin,
      emitterRadiusMax: response.metrics.emitterRadiusMax,
      summaryCacheOutcome: response.metrics.summaryCacheOutcome,
      summaryBuildMs: response.metrics.summaryBuildMs,
      summaryLeafParses: response.metrics.summaryLeafParses,
      summaryRawSourceCount: response.metrics.summaryRawSourceCount,
      summaryRetainedClusterCount: response.metrics.summaryRetainedClusterCount,
      summaryCappedClusterCount: response.metrics.summaryCappedClusterCount,
      totalMs: response.metrics.totalMs,
      queueDepth: response.metrics.queueDepth,
      runningJobs: response.metrics.runningJobs,
      inFlightJobs: response.metrics.inFlightJobs,
      byteLength: response.metrics.byteLength,
      cacheTier: response.metrics.cacheTier,
      quadCount: response.metrics.quadCount,
      greedyCubeQuads: response.metrics.greedyCubeQuads,
      modelQuads: response.metrics.modelQuads,
      droppedModelQuads: response.metrics.droppedModelQuads,
      modelQuadBudget: response.metrics.modelQuadBudget,
      transparentQuads: response.metrics.transparentQuads,
      rawPayloadBytes: response.metrics.rawPayloadBytes,
      greedyRecordBytes: response.metrics.greedyRecordBytes,
      modelRecordBytes: response.metrics.modelRecordBytes,
      chunkColumns: response.metrics.chunkColumns,
      regionsParsed: response.metrics.regionsParsed,
      chunksMeshed: response.metrics.chunksMeshed,
      visitedAirCells: response.metrics.visitedAirCells,
      facesBeforeMerge: response.metrics.facesBeforeMerge,
      externalRegionParses: response.metrics.externalRegionParses,
      externalRegionCacheHits: response.metrics.externalRegionCacheHits,
      externalRegionMisses: response.metrics.externalRegionMisses,
      externalRegionParseErrors: response.metrics.externalRegionParseErrors,
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
