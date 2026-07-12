/**
 * File watcher service using chokidar.
 * Monitors the save directory for changes to surface files, player files,
 * and world metadata, then emits events for real-time updates.
 */

import { EventEmitter } from "node:events";
import { join, relative, sep } from "node:path";
import { type FSWatcher, watch } from "chokidar";
import { logger } from "./logger.js";

export type WatchEventType =
  | "players-updated"
  | "world-updated"
  | "surface-index-changed"
  | "terrain-updates-batch";

export interface TerrainTileUpdate {
  lod: number;
  tileX: number;
  tileY: number;
}

export interface TerrainRegionUpdate {
  lod: number;
  regionX: number;
  regionY: number;
}

export interface SaveWatcherScheduler {
  setTimeout(callback: () => void, delayMs: number): NodeJS.Timeout;
  clearTimeout(timer: NodeJS.Timeout): void;
}

interface SaveWatcherOptions {
  terrainUpdateBatchMs?: number;
  scheduler?: SaveWatcherScheduler;
}

const VALID_LODS = new Set([1, 2, 4, 8, 16, 32]);
const nativeScheduler: SaveWatcherScheduler = { setTimeout, clearTimeout };

export interface WatchEvent {
  type: WatchEventType;
  /** Batch payloads for terrain and voxel region changes. */
  data?:
    | Record<string, unknown>
    | {
        tiles: TerrainTileUpdate[];
        regions: TerrainRegionUpdate[];
      };
  /** Unix timestamp (ms) when the server broadcast this event. */
  sentAt?: number;
}

/**
 * Watches the Cubyz save directory for file changes and emits
 * typed events that the WebSocket server broadcasts to clients.
 */
export class SaveWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private savePath: string;
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private terrainUpdateBatchMs: number;
  private readonly scheduler: SaveWatcherScheduler;
  private terrainBatchTimer: NodeJS.Timeout | null = null;
  private pendingTileUpdates = new Map<string, TerrainTileUpdate>();
  private pendingRegionUpdates = new Map<string, TerrainRegionUpdate>();
  private static readonly DEBOUNCE_MS = 300;

  constructor(savePath: string, options: SaveWatcherOptions = {}) {
    super();
    this.savePath = savePath;
    this.terrainUpdateBatchMs = Math.max(
      0,
      options.terrainUpdateBatchMs ?? 15_000,
    );
    this.scheduler = options.scheduler ?? nativeScheduler;
  }

  start(): void {
    const mapsDir = join(this.savePath, "maps");
    const playersDir = join(this.savePath, "players");
    const worldFile = join(this.savePath, "world.zig.zon");
    const chunksDir = join(this.savePath, "chunks");

    this.watcher = watch([mapsDir, playersDir, worldFile, chunksDir], {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 50,
      },
    });

    this.watcher.on("change", (filePath: string) =>
      this.handleFileEvent("change", filePath),
    );
    this.watcher.on("add", (filePath: string) =>
      this.handleFileEvent("add", filePath),
    );
    this.watcher.on("unlink", (filePath: string) =>
      this.handleFileEvent("unlink", filePath),
    );
    this.watcher.on("error", (err) => {
      logger.error("SaveWatcher error", {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    logger.info("SaveWatcher watching for file changes");
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    for (const timer of this.debounceTimers.values()) {
      this.scheduler.clearTimeout(timer);
    }
    this.debounceTimers.clear();
    if (this.terrainBatchTimer) {
      this.scheduler.clearTimeout(this.terrainBatchTimer);
      this.terrainBatchTimer = null;
    }
    this.pendingTileUpdates.clear();
    this.pendingRegionUpdates.clear();
  }

  private debounce(key: string, fn: () => void): void {
    const existing = this.debounceTimers.get(key);
    if (existing) this.scheduler.clearTimeout(existing);
    this.debounceTimers.set(
      key,
      this.scheduler.setTimeout(() => {
        this.debounceTimers.delete(key);
        fn();
      }, SaveWatcher.DEBOUNCE_MS),
    );
  }

  private queueTileUpdate(tileInfo: TerrainTileUpdate): void {
    this.pendingTileUpdates.set(
      `${tileInfo.lod}/${tileInfo.tileX}/${tileInfo.tileY}`,
      tileInfo,
    );
    this.scheduleTerrainUpdatesBatch();
  }

  private queueRegionUpdate(regionInfo: TerrainRegionUpdate): void {
    this.pendingRegionUpdates.set(
      `${regionInfo.lod}/${regionInfo.regionX}/${regionInfo.regionY}`,
      regionInfo,
    );
    this.scheduleTerrainUpdatesBatch();
  }

  private scheduleTerrainUpdatesBatch(): void {
    if (this.terrainBatchTimer) {
      this.scheduler.clearTimeout(this.terrainBatchTimer);
    }
    this.terrainBatchTimer = this.scheduler.setTimeout(() => {
      this.terrainBatchTimer = null;
      this.flushTerrainUpdatesBatch();
    }, this.terrainUpdateBatchMs);
  }

  private flushTerrainUpdatesBatch(): void {
    if (
      this.pendingTileUpdates.size === 0 &&
      this.pendingRegionUpdates.size === 0
    )
      return;

    const tiles = [...this.pendingTileUpdates.values()];
    const regions = [...this.pendingRegionUpdates.values()];
    this.pendingTileUpdates.clear();
    this.pendingRegionUpdates.clear();

    this.emit("watch-event", {
      type: "terrain-updates-batch",
      data: {
        tiles,
        regions,
      },
    } as WatchEvent);
  }

  handleFileEvent(event: "change" | "add" | "unlink", filePath: string): void {
    if (event === "change") this.handleChange(filePath);
    else if (event === "add") this.handleAdd(filePath);
    else this.handleRemove(filePath);
  }

  private handleChange(filePath: string): void {
    const rel = relative(this.savePath, filePath).split(sep).join("/");

    if (rel === "world.zig.zon") {
      this.debounce("world", () => {
        this.emit("watch-event", { type: "world-updated" } as WatchEvent);
      });
      return;
    }

    if (rel.startsWith("players/")) {
      this.debounce("players", () => {
        this.emit("watch-event", { type: "players-updated" } as WatchEvent);
      });
      return;
    }

    const tileInfo = this.parseSurfacePath(rel);
    if (tileInfo) {
      this.queueTileUpdate(tileInfo);
      return;
    }

    const regionInfo = this.parseRegionPath(rel);
    if (regionInfo) {
      this.queueRegionUpdate(regionInfo);
    }
  }

  private handleAdd(filePath: string): void {
    const rel = relative(this.savePath, filePath).split(sep).join("/");

    if (rel.endsWith(".surface")) {
      const tileInfo = this.parseSurfacePath(rel);
      if (tileInfo) {
        // New surface file means the surface index changed
        this.debounce("surface-index", () => {
          this.emit("watch-event", {
            type: "surface-index-changed",
          } as WatchEvent);
        });
        this.queueTileUpdate(tileInfo);
      }
    }

    if (rel.endsWith(".region")) {
      const regionInfo = this.parseRegionPath(rel);
      if (regionInfo) {
        this.queueRegionUpdate(regionInfo);
      }
    }

    if (rel.startsWith("players/")) {
      this.debounce("players", () => {
        this.emit("watch-event", { type: "players-updated" } as WatchEvent);
      });
    }
  }

  private handleRemove(filePath: string): void {
    const rel = relative(this.savePath, filePath).split(sep).join("/");

    if (rel.endsWith(".surface")) {
      const tileInfo = this.parseSurfacePath(rel);
      if (tileInfo) {
        this.debounce("surface-index", () => {
          this.emit("watch-event", {
            type: "surface-index-changed",
          } as WatchEvent);
        });
        this.queueTileUpdate(tileInfo);
      }
    }

    if (rel.endsWith(".region")) {
      const regionInfo = this.parseRegionPath(rel);
      if (regionInfo) {
        this.queueRegionUpdate(regionInfo);
      }
    }
  }

  /**
   * Parse a relative surface file path like "maps/1/2048/768.surface"
   * into { lod, tileX, tileY }.
   */
  private parseSurfacePath(rel: string): TerrainTileUpdate | null {
    // Expected: maps/{lod}/{worldX}/{worldY}.surface
    const match = rel.match(/^maps\/(\d+)\/(-?\d+)\/(-?\d+)\.surface$/);
    if (!match) return null;

    const lod = parseInt(match[1], 10);
    const worldX = parseInt(match[2], 10);
    const worldY = parseInt(match[3], 10);
    const mapSize = 256;
    const tileX = worldX / (mapSize * lod);
    const tileY = worldY / (mapSize * lod);

    if (
      !VALID_LODS.has(lod) ||
      !Number.isInteger(tileX) ||
      !Number.isInteger(tileY)
    )
      return null;

    return { lod, tileX, tileY };
  }

  /**
   * Parse a relative region file path like "chunks/2/256/384/128.region"
   * into { lod, regionX, regionY }.
   */
  private parseRegionPath(rel: string): TerrainRegionUpdate | null {
    // Expected: chunks/{lod}/{worldX}/{worldY}/{worldZ}.region
    const match = rel.match(/^chunks\/(\d+)\/(-?\d+)\/(-?\d+)\/-?\d+\.region$/);
    if (!match) return null;

    const lod = parseInt(match[1], 10);
    const regionX = parseInt(match[2], 10);
    const regionY = parseInt(match[3], 10);

    if (
      !VALID_LODS.has(lod) ||
      Number.isNaN(regionX) ||
      Number.isNaN(regionY) ||
      regionX % (128 * lod) !== 0 ||
      regionY % (128 * lod) !== 0
    )
      return null;

    return { lod, regionX, regionY };
  }
}
