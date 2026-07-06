/**
 * Sign records API route.
 * GET /api/signs/:lod/:regionX/:regionY
 *
 * Returns per-region sign records as JSON, keyed by LOD + region coordinates,
 * aligned with the voxel/region addressing scheme. Records are obtained through
 * `VoxelMeshService`; the binary voxel mesh payload stays geometry-only.
 */

import { type Request, type Response, Router } from "express";
import { logger } from "../services/logger.js";
import type { VoxelMeshService } from "../services/voxel-mesh-service.js";
import { assertAlignedRegion, parseRegionParams } from "./validation.js";

const SIGN_CACHE_CONTROL = "public, max-age=0, must-revalidate";

export function createSignsRouter(voxelMeshService: VoxelMeshService): Router {
  const router = Router();

  router.get("/:lod/:regionX/:regionY", async (req: Request, res: Response) => {
    const { lod, regionX, regionY } = parseRegionParams(req.params);
    assertAlignedRegion(lod, regionX, regionY);

    const records = await voxelMeshService.getSignRecords(
      lod,
      regionX,
      regionY,
    );

    logger.http("sign records request completed", {
      requestId: req.requestId,
      route: "/api/signs/:lod/:regionX/:regionY",
      lod,
      regionX,
      regionY,
      count: records.length,
    });

    res.set("Cache-Control", SIGN_CACHE_CONTROL);
    res.json(records);
  });

  return router;
}
