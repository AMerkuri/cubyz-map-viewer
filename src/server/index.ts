/**
 * Cubyz Map Viewer - Express API Server
 * Parses Cubyz save files and serves map tile/terrain data.
 * Includes WebSocket server for real-time file change notifications.
 */

import express from "express";
import compression from "compression";
import { createServer } from "http";
import { join, resolve, dirname } from "path";
import { existsSync } from "fs";
import { readdir } from "fs/promises";
import { fileURLToPath } from "url";
import { homedir } from "os";
import { WebSocketServer, type WebSocket } from "ws";

import { loadPalette } from "./parsers/palette.js";
import { parseWorldMeta } from "./parsers/world-meta.js";
import { loadAllBiomes } from "./parsers/biome.js";
import { ColorMapService } from "./services/color-map.js";
import { LRUCache } from "./services/cache.js";
import { SaveWatcher, type WatchEvent } from "./services/watcher.js";
import { buildBlockColorTable } from "./services/block-color-table.js";
import { VoxelMeshService } from "./services/voxel-mesh-service.js";
import { logger } from "./services/logger.js";
import { createTilesRouter } from "./api/tiles.js";
import { createWorldRouter } from "./api/world.js";
import { createPlayersRouter } from "./api/players.js";
import { createTerrainRouter } from "./api/terrain.js";
import { createBiomesRouter } from "./api/biomes.js";
import { createVoxelsRouter } from "./api/voxels.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.env.PORT ?? "3001");
const HOST = process.env.HOST ?? "0.0.0.0";
const CACHE_SIZE = parseInt(process.env.CACHE_SIZE ?? "500");
const VOXEL_FULL_CLEAR_THROTTLE_MS = parseInt(process.env.VOXEL_FULL_CLEAR_THROTTLE_MS ?? "1000");
const TERRAIN_UPDATE_BATCH_MS = parseInt(process.env.TERRAIN_UPDATE_BATCH_MS ?? "15000");

interface TerrainUpdatesBatchData {
  tiles: { lod: number; tileX: number; tileY: number }[];
  regions: { lod: number; regionX: number; regionY: number }[];
}

async function findSavePath(): Promise<string> {
  // Check env var first
  if (process.env.SAVE_PATH) {
    return resolve(process.env.SAVE_PATH);
  }

  // Check CLI args: --save=<path> or --save <path>
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith("--save=")) {
      return resolve(arg.slice(7));
    }
    if (arg === "--save" && process.argv[i + 1]) {
      return resolve(process.argv[i + 1]);
    }
  }

  // Auto-detect: use the most recently used save
  const savesDir = join(homedir(), ".cubyz", "saves");
  if (!existsSync(savesDir)) {
    throw new Error(
      `No saves directory found at ${savesDir}. Use --save=<path> to specify.`
    );
  }

  const saves = await readdir(savesDir);
  if (saves.length === 0) {
    throw new Error("No saves found in ~/.cubyz/saves/");
  }

  // Return the first save found (could be improved to pick most recent)
  const savePath = join(savesDir, saves[0]);
  logger.info("Auto-detected save", { savePath });
  return savePath;
}

function findCubyzPath(): string {
  if (process.env.CUBYZ_PATH) {
    return resolve(process.env.CUBYZ_PATH);
  }

  // Check CLI args
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith("--cubyz=")) {
      return resolve(arg.slice(8));
    }
    if (arg === "--cubyz" && process.argv[i + 1]) {
      return resolve(process.argv[i + 1]);
    }
  }

  // Default: parent of project directory
  const parentDir = resolve(__dirname, "..", "..", "..");
  if (existsSync(join(parentDir, "assets", "cubyz"))) {
    return parentDir;
  }

  throw new Error(
    "Cannot find Cubyz assets directory. Use --cubyz=<path> to specify."
  );
}

async function main() {
  logger.info("Cubyz Map Viewer - Starting...");

  // Resolve paths
  const savePath = await findSavePath();
  const cubyzPath = findCubyzPath();
  const assetsPath = join(cubyzPath, "assets", "cubyz");

  logger.info("Resolved paths", { savePath, cubyzPath, assetsPath });

  // Verify save exists
  if (!existsSync(join(savePath, "world.zig.zon"))) {
    throw new Error(`Invalid save directory: ${savePath} (no world.zig.zon)`);
  }

  // Load world metadata
  logger.info("Loading world metadata");
  const worldMeta = await parseWorldMeta(join(savePath, "world.zig.zon"));
  logger.info("Loaded world metadata", { worldName: worldMeta.name, spawn: worldMeta.spawn });

  // Load palettes
  logger.info("Loading palettes");
  const blockPalette = await loadPalette(join(savePath, "palette.zig.zon"));
  const biomePalette = await loadPalette(
    join(savePath, "biome_palette.zig.zon")
  );
  logger.info("Loaded palettes", {
    blockPaletteEntries: blockPalette.entries.length,
    biomePaletteEntries: biomePalette.entries.length,
  });

  // Load biome definitions
  logger.info("Loading biome definitions");
  const biomeDefinitions = await loadAllBiomes(join(assetsPath, "biomes"));
  logger.info("Loaded biome definitions", { count: biomeDefinitions.size });

  // Initialize color map
  logger.info("Building color map from block textures");
  const colorMap = new ColorMapService();
  await colorMap.initialize(assetsPath, blockPalette, biomePalette, biomeDefinitions);
  const voxelMeshService = new VoxelMeshService(
    savePath,
    buildBlockColorTable(colorMap),
    process.env.VOXEL_WORKERS ? parseInt(process.env.VOXEL_WORKERS) : undefined,
  );
  await voxelMeshService.start();

  // Create tile cache (stores rendered PNGs with source file mtime for invalidation)
  const tileCache = new LRUCache<string, { buf: Buffer; mtime: number }>(CACHE_SIZE);

  // Create Express app
  const app = express();

  // Compress all responses (gzip/deflate)
  app.use(compression());

  // CORS for dev
  app.use((_req, res, next) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    next();
  });

  app.use((req, res, next) => {
    const startedAt = performance.now();
    res.on("finish", () => {
      logger.http("request completed", {
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        responseTimeMs: Number((performance.now() - startedAt).toFixed(3)),
        userAgent: req.get("user-agent"),
        ip: req.ip,
      });
    });
    next();
  });

  // API routes
  app.use("/api/tiles", createTilesRouter(savePath, colorMap, tileCache));
  app.use("/api/world", createWorldRouter(savePath, worldMeta));
  app.use("/api/players", createPlayersRouter(savePath));
  app.use("/api/terrain", createTerrainRouter(savePath, colorMap));
  app.use("/api/biomes", createBiomesRouter(savePath, biomePalette));
  app.use("/api/voxels", createVoxelsRouter(voxelMeshService));

  app.get("/api/blocks/colors", (_req, res) => {
    res.json(colorMap.getAllBlockColors());
  });

  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      savePath,
      worldName: worldMeta.name,
      cacheSize: tileCache.size,
    });
  });

  // Create HTTP server for both Express and WebSocket
  const server = createServer(app);

  // WebSocket server for real-time updates
  const wss = new WebSocketServer({ server, path: "/ws" });
  const wsClients = new Set<WebSocket>();

  wss.on("connection", (ws) => {
    wsClients.add(ws);
    logger.info("WebSocket client connected", { totalClients: wsClients.size });
    ws.send(JSON.stringify({
      type: "viewer-ws-connected",
      sentAt: Date.now(),
    }));

    ws.on("close", () => {
      wsClients.delete(ws);
      logger.info("WebSocket client disconnected", { totalClients: wsClients.size });
    });

    ws.on("error", (err) => {
      logger.error("WebSocket error", { error: err instanceof Error ? err.message : String(err) });
      wsClients.delete(ws);
    });
  });

  function broadcast(event: WatchEvent): void {
    logger.info("Watch event broadcast", { eventType: event.type, eventData: event.data ?? null });
    const msg = JSON.stringify({
      ...event,
      sentAt: Date.now(),
    });
    for (const client of wsClients) {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(msg);
      }
    }
  }

  // File watcher for live updates
  const watcher = new SaveWatcher(savePath, { terrainUpdateBatchMs: TERRAIN_UPDATE_BATCH_MS });
  let voxelFullClearCooldownUntil = 0;

  watcher.on("watch-event", (event: WatchEvent) => {
    if (event.type === "terrain-updates-batch" && event.data) {
      const { tiles, regions } = event.data as TerrainUpdatesBatchData;

      for (const tile of tiles) {
        tileCache.delete(`${tile.lod}/${tile.tileX}/${tile.tileY}`);
      }

      if (tiles.length > 0) {
        const now = Date.now();
        if (now >= voxelFullClearCooldownUntil) {
          voxelMeshService.clearAll();
          voxelFullClearCooldownUntil = now + VOXEL_FULL_CLEAR_THROTTLE_MS;
        }
      }

      for (const region of regions) {
        voxelMeshService.clear(`${region.lod}/${region.regionX}/${region.regionY}`);
      }
    }
    // Broadcast to all connected WebSocket clients
    broadcast(event);
  });

  watcher.start();

  // Graceful shutdown
  process.on("SIGINT", () => {
    logger.info("Shutting down");
    watcher.stop();
    wss.close();
    server.close();
    void voxelMeshService.destroy().finally(() => {
      process.exit(0);
    });
  });

  // Start server
  server.listen(PORT, HOST, () => {
    logger.info("Server listening", {
      url: `http://localhost:${PORT}`,
      frontendUrl: "http://localhost:5173",
      endpoints: [
        "GET /api/world",
        "GET /api/world/surface-index",
        "GET /api/world/chunk-index",
        "GET /api/players",
        "GET /api/tiles/:lod/:x/:y.png",
        "GET /api/terrain/:lod/:x/:y",
        "GET /api/biomes/:lod/:x/:y",
        "GET /api/voxels/:lod/:rx/:ry",
        "GET /api/blocks/colors",
        "WS /ws",
      ],
    });
  });
}

main().catch((err) => {
  logger.error("Fatal error", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
