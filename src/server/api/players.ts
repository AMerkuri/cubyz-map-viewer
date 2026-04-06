/**
 * Players API route.
 * GET /api/players - Returns all player data.
 */

import { Router, type Request, type Response } from "express";
import { join } from "path";
import { loadAllPlayers } from "../parsers/player.js";

export function createPlayersRouter(savePath: string): Router {
  const router = Router();

  router.get("/", async (_req: Request, res: Response) => {
    try {
      const players = await loadAllPlayers(join(savePath, "players"));
      res.json(players);
    } catch (e) {
      console.error(`Players error: ${e}`);
      res.json([]);
    }
  });

  return router;
}
