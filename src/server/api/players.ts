/**
 * Players API route.
 * GET /api/players - Returns all player data.
 */

import { join } from "node:path";
import { type Request, type Response, Router } from "express";
import {
  DEFAULT_PLAYER_ACTIVE_WINDOW_MS,
  DEFAULT_PLAYER_RETENTION_MS,
  loadAllPlayers,
} from "../parsers/player.js";
import { logger } from "../services/logger.js";

const PLAYER_ACTIVE_WINDOW_MS = parseInt(
  process.env.PLAYER_ACTIVE_WINDOW_MS ?? `${DEFAULT_PLAYER_ACTIVE_WINDOW_MS}`,
  10,
);
const PLAYER_RETENTION_MS = parseInt(
  process.env.PLAYER_RETENTION_MS ?? `${DEFAULT_PLAYER_RETENTION_MS}`,
  10,
);

export function createPlayersRouter(savePath: string): Router {
  const router = Router();

  router.get("/", async (req: Request, res: Response) => {
    try {
      const players = await loadAllPlayers(join(savePath, "players"), {
        activeWindowMs: PLAYER_ACTIVE_WINDOW_MS,
        retentionMs: PLAYER_RETENTION_MS,
      });
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
