/**
 * Players API route.
 * GET /api/players - Returns all player data.
 */

import { join } from "node:path";
import { type Request, type Response, Router } from "express";
import { loadAllPlayers } from "../parsers/player.js";
import { logger } from "../services/logger.js";

export function createPlayersRouter(savePath: string): Router {
  const router = Router();

  router.get("/", async (req: Request, res: Response) => {
    try {
      const players = await loadAllPlayers(join(savePath, "players"));
      res.json(players);
    } catch (e) {
      logger.error("Players error", {
        requestId: req.requestId,
        error: e instanceof Error ? e.message : String(e),
      });
      res.json([]);
    }
  });

  return router;
}
