import { type Request, type Response, Router } from "express";
import type { EntityModelAssetService } from "../services/entity-model-assets.js";
import { BadRequestError, NotFoundError } from "./errors.js";

const ASSET_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;

export function createAssetsRouter(
  entityModelAssets: EntityModelAssetService,
): Router {
  const router = Router();

  router.get("/player-marker", async (_req: Request, res: Response) => {
    res.json(await entityModelAssets.getPlayerMarkerManifest());
  });

  router.get(
    "/entity-models/files/:token",
    async (req: Request, res: Response) => {
      const token = Array.isArray(req.params.token)
        ? req.params.token[0]
        : req.params.token;
      if (!token || !ASSET_TOKEN_PATTERN.test(token)) {
        throw new BadRequestError("Invalid asset token");
      }

      const filePath = await entityModelAssets.getEntityModelAssetFile(token);
      if (!filePath) {
        throw new NotFoundError("Entity model asset not found");
      }

      res.sendFile(filePath);
    },
  );

  return router;
}
