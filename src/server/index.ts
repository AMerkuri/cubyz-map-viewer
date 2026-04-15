/**
 * Cubyz Map Viewer - Express API Server
 * Parses Cubyz save files and serves map tile/terrain data.
 * Includes WebSocket server for real-time file change notifications.
 */

import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import compression from "compression";
import express from "express";
import { type WebSocket, WebSocketServer } from "ws";
import { createBiomesRouter } from "./api/biomes.js";
import { errorHandler } from "./api/error-handler.js";
import { createPlayersRouter } from "./api/players.js";
import { requestContextMiddleware } from "./api/request-context.js";
import { createTerrainRouter } from "./api/terrain.js";
import { parseSafeAssetName } from "./api/validation.js";
import { createVoxelsRouter } from "./api/voxels.js";
import { createWorldRouter } from "./api/world.js";
import { loadAllBiomes } from "./parsers/biome.js";
import { loadPalette } from "./parsers/palette.js";
import { parseWorldMeta } from "./parsers/world-meta.js";
import { buildBlockColorTable } from "./services/block-color-table.js";
import { buildChunkIndex } from "./services/chunk-index.js";
import { ColorMapService } from "./services/color-map.js";
import { logger } from "./services/logger.js";
import { VoxelMeshService } from "./services/voxel-mesh-service.js";
import { SaveWatcher, type WatchEvent } from "./services/watcher.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.env.PORT ?? "3001", 10);
const HOST = process.env.HOST ?? "0.0.0.0";
const VOXEL_MEMORY_CACHE_SIZE = parseInt(
  process.env.VOXEL_MEMORY_CACHE_SIZE ?? "1024",
  10,
);
const VOXEL_FULL_CLEAR_THROTTLE_MS = parseInt(
  process.env.VOXEL_FULL_CLEAR_THROTTLE_MS ?? "1000",
  10,
);
const TERRAIN_UPDATE_BATCH_MS = parseInt(
  process.env.TERRAIN_UPDATE_BATCH_MS ?? "15000",
  10,
);
const VOXEL_PREGENERATE_ON_STARTUP = parseBooleanEnv(
  process.env.VOXEL_PREGENERATE_ON_STARTUP,
);

interface TerrainUpdatesBatchData {
  tiles: { lod: number; tileX: number; tileY: number }[];
  regions: { lod: number; regionX: number; regionY: number }[];
}

const allowedOrigins = new Set(
  (process.env.CORS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

function parseBooleanEnv(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

async function warmVoxelCacheOnStartup(
  savePath: string,
  voxelMeshService: VoxelMeshService,
  shouldContinue: () => boolean,
): Promise<void> {
  const chunkIndex = await buildChunkIndex(savePath);
  if (chunkIndex.length === 0) {
    logger.info("Voxel startup warmup skipped; no voxel regions found");
    return;
  }

  const workers = voxelMeshService.getMetricsSnapshot().workers;
  const concurrency = Math.max(1, Math.min(workers, 4));
  let nextIndex = 0;
  let completed = 0;
  let warmed = 0;
  let empty = 0;
  let failed = 0;

  logger.info("Voxel startup warmup started", {
    regions: chunkIndex.length,
    concurrency,
    workers,
  });

  const warmRegion = async (): Promise<void> => {
    while (shouldContinue()) {
      const region = chunkIndex[nextIndex++];
      if (!region) {
        return;
      }

      const key = `${region.lod}/${region.regionX}/${region.regionY}`;
      try {
        const response = await voxelMeshService.getVoxelMesh(
          key,
          region.lod,
          region.regionX,
          region.regionY,
          "identity",
        );
        if (response.status === "ok") {
          warmed++;
        } else {
          empty++;
        }
      } catch (error) {
        failed++;
        logger.warn("Voxel startup warmup region failed", {
          key,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        completed++;
        if (
          completed === chunkIndex.length ||
          completed % Math.max(1, Math.ceil(chunkIndex.length / 10)) === 0
        ) {
          logger.info("Voxel startup warmup progress", {
            completed,
            total: chunkIndex.length,
            warmed,
            empty,
            failed,
          });
        }
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => warmRegion()));

  logger.info("Voxel startup warmup finished", {
    completed,
    total: chunkIndex.length,
    warmed,
    empty,
    failed,
    interrupted: completed < chunkIndex.length,
  });
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
      `No saves directory found at ${savesDir}. Use --save=<path> to specify.`,
    );
  }

  const saves = await readdir(savesDir);
  if (saves.length === 0) {
    throw new Error("No saves found in ~/.cubyz/saves/");
  }

  const saveEntries = await Promise.all(
    saves.map(async (save) => {
      const savePath = join(savesDir, save);
      const saveStat = await stat(savePath);
      return saveStat.isDirectory()
        ? { savePath, mtimeMs: saveStat.mtimeMs }
        : null;
    }),
  );
  const directories = saveEntries.filter(
    (entry): entry is { savePath: string; mtimeMs: number } => entry !== null,
  );
  directories.sort((left, right) => right.mtimeMs - left.mtimeMs);
  const savePath = directories[0]?.savePath;
  if (!savePath) {
    throw new Error(`No readable saves found in ${savesDir}`);
  }
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
    "Cannot find Cubyz assets directory. Use --cubyz=<path> to specify.",
  );
}

async function main() {
  logger.info("Cubyz Map Viewer - Starting...");

  // Resolve paths
  const savePath = await findSavePath();
  const cubyzPath = findCubyzPath();
  const assetsPath = join(cubyzPath, "assets", "cubyz");
  const clientDistDir = resolve(__dirname, "..", "client");
  const clientIndexPath = join(clientDistDir, "index.html");
  const hasBuiltClient = existsSync(clientIndexPath);

  logger.info("Resolved paths", { savePath, cubyzPath, assetsPath });

  // Verify save exists
  if (!existsSync(join(savePath, "world.zig.zon"))) {
    throw new Error(`Invalid save directory: ${savePath} (no world.zig.zon)`);
  }

  // Load world metadata
  logger.info("Loading world metadata");
  const worldMeta = await parseWorldMeta(join(savePath, "world.zig.zon"));
  logger.info("Loaded world metadata", {
    worldName: worldMeta.name,
    spawn: worldMeta.spawn,
  });

  // Load palettes
  logger.info("Loading palettes");
  const blockPalette = await loadPalette(join(savePath, "palette.zig.zon"));
  const biomePalette = await loadPalette(
    join(savePath, "biome_palette.zig.zon"),
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
  await colorMap.initialize(
    assetsPath,
    blockPalette,
    biomePalette,
    biomeDefinitions,
  );
  const voxelMeshService = new VoxelMeshService(
    savePath,
    buildBlockColorTable(colorMap),
    process.env.VOXEL_WORKERS
      ? parseInt(process.env.VOXEL_WORKERS, 10)
      : undefined,
    VOXEL_MEMORY_CACHE_SIZE,
  );
  await voxelMeshService.start();

  // Create Express app
  const app = express();

  // Voxel responses negotiate and cache their own encoded variants.
  app.use(
    compression({
      filter: (req, res) => {
        if (req.path === "/api/voxels" || req.path.startsWith("/api/voxels/")) {
          return false;
        }
        return compression.filter(req, res);
      },
    }),
  );

  app.use(requestContextMiddleware);

  // CORS for explicit cross-origin use only
  app.use((req, res, next) => {
    const origin = req.get("origin");
    if (origin && allowedOrigins.has(origin)) {
      res.set("Access-Control-Allow-Origin", origin);
      res.set("Vary", "Origin");
      res.set("Access-Control-Allow-Methods", "GET,OPTIONS");
      res.set("Access-Control-Allow-Headers", "Content-Type,X-Request-Id");
      res.set(
        "Access-Control-Expose-Headers",
        "X-Request-Id,X-Voxel-Source,X-Voxel-Queue-Ms,X-Voxel-Run-Ms,X-Voxel-Total-Ms,X-Voxel-Queue-Depth,X-Voxel-Running,X-Voxel-In-Flight",
      );
    }
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Cross-Origin-Resource-Policy", "same-origin");
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  app.use((req, res, next) => {
    const startedAt = performance.now();
    res.on("finish", () => {
      logger.http("request completed", {
        requestId: req.requestId,
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
  app.use("/api/world", createWorldRouter(savePath, worldMeta));
  app.use("/api/players", createPlayersRouter(savePath));
  app.use("/api/terrain", createTerrainRouter(savePath, colorMap));
  app.use("/api/biomes", createBiomesRouter(savePath, biomePalette));
  app.use("/api/voxels", createVoxelsRouter(voxelMeshService));

  app.get("/api/blocks/colors", (_req, res) => {
    res.json(colorMap.getAllBlockColors());
  });

  app.get("/api/assets/entities/textures/:name", (req, res) => {
    const textureName = parseSafeAssetName(req.params.name, "texture name");
    res.sendFile(join(assetsPath, "entities", "textures", textureName));
  });

  app.get("/api/assets/entities/models/:name", (req, res) => {
    const modelName = parseSafeAssetName(req.params.name, "model name");
    res.sendFile(join(assetsPath, "entities", "models", modelName));
  });

  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      savePath,
      worldName: worldMeta.name,
    });
  });

  if (hasBuiltClient) {
    app.use(
      express.static(clientDistDir, {
        index: false,
      }),
    );

    app.use((req, res, next) => {
      if (req.method !== "GET") {
        next();
        return;
      }
      if (
        req.path === "/api" ||
        req.path.startsWith("/api/") ||
        req.path === "/ws"
      ) {
        next();
        return;
      }
      res.sendFile(clientIndexPath);
    });
  } else {
    logger.warn("Built client bundle not found; serving API only", {
      clientDistDir,
    });
  }

  app.use(errorHandler);

  // Create HTTP server for both Express and WebSocket
  const server = createServer(app);

  // WebSocket server for real-time updates
  const wss = new WebSocketServer({ server, path: "/ws" });
  const wsClients = new Set<WebSocket>();

  wss.on("connection", (ws) => {
    wsClients.add(ws);
    logger.info("WebSocket client connected", { totalClients: wsClients.size });
    ws.send(
      JSON.stringify({
        type: "viewer-ws-connected",
        sentAt: Date.now(),
      }),
    );

    ws.on("close", () => {
      wsClients.delete(ws);
      logger.info("WebSocket client disconnected", {
        totalClients: wsClients.size,
      });
    });

    ws.on("error", (err) => {
      logger.error("WebSocket error", {
        error: err instanceof Error ? err.message : String(err),
      });
      wsClients.delete(ws);
    });
  });

  function broadcast(event: WatchEvent): void {
    logger.info("Watch event broadcast", {
      eventType: event.type,
      eventData: event.data ?? null,
    });
    const msg = JSON.stringify({
      ...event,
      sentAt: Date.now(),
    });
    for (const client of wsClients) {
      if (client.readyState === 1) {
        // WebSocket.OPEN
        client.send(msg);
      }
    }
  }

  // File watcher for live updates
  const watcher = new SaveWatcher(savePath, {
    terrainUpdateBatchMs: TERRAIN_UPDATE_BATCH_MS,
  });
  let voxelFullClearCooldownUntil = 0;

  watcher.on("watch-event", (event: WatchEvent) => {
    if (event.type === "terrain-updates-batch" && event.data) {
      const { tiles, regions } = event.data as TerrainUpdatesBatchData;

      if (tiles.length > 0) {
        const now = Date.now();
        if (now >= voxelFullClearCooldownUntil) {
          voxelMeshService.clearAll();
          voxelFullClearCooldownUntil = now + VOXEL_FULL_CLEAR_THROTTLE_MS;
        }
      }

      for (const region of regions) {
        voxelMeshService.clear(
          `${region.lod}/${region.regionX}/${region.regionY}`,
        );
      }
    }
    // Broadcast to all connected WebSocket clients
    broadcast(event);
  });

  watcher.start();

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = async (signal: "SIGINT" | "SIGTERM") => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("Shutting down", { signal });
    watcher.stop();
    await new Promise<void>((resolveClose) => {
      wss.close(() => resolveClose());
      for (const client of wsClients) {
        client.close();
      }
    });
    await new Promise<void>((resolveClose) => {
      server.close(() => resolveClose());
    });
    await voxelMeshService.destroy();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  // Start server
  server.listen(PORT, HOST, () => {
    logger.info("Server listening", {
      url: `http://localhost:${PORT}`,
      frontendUrl: hasBuiltClient
        ? `http://localhost:${PORT}`
        : "http://localhost:5173",
      servingBuiltClient: hasBuiltClient,
      endpoints: [
        "GET /api/world",
        "GET /api/world/surface-index",
        "GET /api/world/chunk-index",
        "GET /api/players",
        "GET /api/terrain/:lod/:x/:y",
        "GET /api/biomes/:lod/:x/:y",
        "GET /api/voxels/:lod/:rx/:ry",
        "GET /api/blocks/colors",
        "WS /ws",
      ],
    });

    if (VOXEL_PREGENERATE_ON_STARTUP) {
      void warmVoxelCacheOnStartup(
        savePath,
        voxelMeshService,
        () => !shuttingDown,
      ).catch((error) => {
        logger.error("Voxel startup warmup failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  });
}

main().catch((err) => {
  logger.error("Fatal error", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
