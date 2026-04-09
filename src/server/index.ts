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
import { createTilesRouter } from "./api/tiles.js";
import { createWorldRouter } from "./api/world.js";
import { createPlayersRouter } from "./api/players.js";
import { createTerrainRouter } from "./api/terrain.js";
import { createBiomesRouter } from "./api/biomes.js";
import { createVoxelsRouter, clearAllVoxelCache, clearVoxelCache } from "./api/voxels.js";

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
  console.log(`Auto-detected save: ${savePath}`);
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
  console.log("Cubyz Map Viewer - Starting...");

  // Resolve paths
  const savePath = await findSavePath();
  const cubyzPath = findCubyzPath();
  const assetsPath = join(cubyzPath, "assets", "cubyz");

  console.log(`Save path: ${savePath}`);
  console.log(`Cubyz path: ${cubyzPath}`);
  console.log(`Assets path: ${assetsPath}`);

  // Verify save exists
  if (!existsSync(join(savePath, "world.zig.zon"))) {
    throw new Error(`Invalid save directory: ${savePath} (no world.zig.zon)`);
  }

  // Load world metadata
  console.log("Loading world metadata...");
  const worldMeta = await parseWorldMeta(join(savePath, "world.zig.zon"));
  console.log(`World: ${worldMeta.name}, Spawn: (${worldMeta.spawn.join(", ")})`);

  // Load palettes
  console.log("Loading palettes...");
  const blockPalette = await loadPalette(join(savePath, "palette.zig.zon"));
  const biomePalette = await loadPalette(
    join(savePath, "biome_palette.zig.zon")
  );
  console.log(
    `Block palette: ${blockPalette.entries.length} entries, Biome palette: ${biomePalette.entries.length} entries`
  );

  // Load biome definitions
  console.log("Loading biome definitions...");
  const biomeDefinitions = await loadAllBiomes(join(assetsPath, "biomes"));
  console.log(`Loaded ${biomeDefinitions.size} biome definitions`);

  // Initialize color map
  console.log("Building color map from block textures...");
  const colorMap = new ColorMapService();
  await colorMap.initialize(assetsPath, blockPalette, biomePalette, biomeDefinitions);

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

  // API routes
  app.use("/api/tiles", createTilesRouter(savePath, colorMap, tileCache));
  app.use("/api/world", createWorldRouter(savePath, worldMeta));
  app.use("/api/players", createPlayersRouter(savePath));
  app.use("/api/terrain", createTerrainRouter(savePath, colorMap));
  app.use("/api/biomes", createBiomesRouter(savePath, biomePalette));
  app.use("/api/voxels", createVoxelsRouter(savePath, colorMap));

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
    console.log(`WebSocket client connected (${wsClients.size} total)`);
    ws.send(JSON.stringify({
      type: "viewer-ws-connected",
      sentAt: Date.now(),
    }));

    ws.on("close", () => {
      wsClients.delete(ws);
      console.log(`WebSocket client disconnected (${wsClients.size} total)`);
    });

    ws.on("error", (err) => {
      console.error("WebSocket error:", err);
      wsClients.delete(ws);
    });
  });

  function broadcast(event: WatchEvent): void {
    console.log("Watch event broadcast:", event.type, event.data ?? "");
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
          clearAllVoxelCache();
          voxelFullClearCooldownUntil = now + VOXEL_FULL_CLEAR_THROTTLE_MS;
        }
      }

      for (const region of regions) {
        clearVoxelCache(`${region.lod}/${region.regionX}/${region.regionY}`);
      }
    }
    // Broadcast to all connected WebSocket clients
    broadcast(event);
  });

  watcher.start();

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\nShutting down...");
    watcher.stop();
    wss.close();
    server.close();
    process.exit(0);
  });

  // Start server
  server.listen(PORT, HOST, () => {
    console.log(`\nCubyz Map Viewer API running on http://localhost:${PORT}`);
    console.log(`Frontend dev server: http://localhost:5173`);
    console.log(`\nAPI endpoints:`);
    console.log(`  GET /api/world              - World metadata`);
    console.log(`  GET /api/world/surface-index - Available surface files`);
    console.log(`  GET /api/world/chunk-index  - Available chunk columns`);
    console.log(`  GET /api/players            - Player positions`);
    console.log(`  GET /api/tiles/:lod/:x/:y.png - Map tiles`);
    console.log(`  GET /api/terrain/:lod/:x/:y - 3D terrain data`);
    console.log(`  GET /api/biomes/:lod/:x/:y  - Biome regions for tile`);
    console.log(`  GET /api/voxels/:lod/:rx/:ry - Greedy-meshed voxel geometry`);
    console.log(`  GET /api/blocks/colors      - Block color palette`);
    console.log(`  WS  /ws                     - Real-time updates`);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
