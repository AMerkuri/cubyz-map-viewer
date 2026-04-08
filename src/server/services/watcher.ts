/**
 * File watcher service using chokidar.
 * Monitors the save directory for changes to surface files, player files,
 * and world metadata, then emits events for real-time updates.
 */

import { watch, type FSWatcher } from "chokidar";
import { join, relative, sep } from "path";
import { EventEmitter } from "events";

export type WatchEventType =
  | "tile-updated"
  | "players-updated"
  | "world-updated"
  | "surface-index-changed"
  | "region-updated";

export interface WatchEvent {
  type: WatchEventType;
  /** For tile-updated: { lod, tileX, tileY } */
  data?: Record<string, unknown>;
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
  private static readonly DEBOUNCE_MS = 300;

  constructor(savePath: string) {
    super();
    this.savePath = savePath;
  }

  start(): void {
    const mapsGlob = join(this.savePath, "maps", "**", "*.surface");
    const playersGlob = join(this.savePath, "players", "*.zon");
    const worldFile = join(this.savePath, "world.zig.zon");
    const chunksGlob = join(this.savePath, "chunks", "**", "*.region");

    this.watcher = watch([mapsGlob, playersGlob, worldFile, chunksGlob], {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 50,
      },
    });

    this.watcher.on("change", (filePath: string) => this.handleChange(filePath));
    this.watcher.on("add", (filePath: string) => this.handleAdd(filePath));
    this.watcher.on("unlink", (filePath: string) => this.handleRemove(filePath));

    console.log("SaveWatcher: watching for file changes...");
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  private debounce(key: string, fn: () => void): void {
    const existing = this.debounceTimers.get(key);
    if (existing) clearTimeout(existing);
    this.debounceTimers.set(
      key,
      setTimeout(() => {
        this.debounceTimers.delete(key);
        fn();
      }, SaveWatcher.DEBOUNCE_MS)
    );
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
      const key = `tile-${tileInfo.lod}-${tileInfo.tileX}-${tileInfo.tileY}`;
      this.debounce(key, () => {
        this.emit("watch-event", {
          type: "tile-updated",
          data: tileInfo,
        } as WatchEvent);
      });
      return;
    }

    const regionInfo = this.parseRegionPath(rel);
    if (regionInfo) {
      const key = `region-${regionInfo.regionX}-${regionInfo.regionY}`;
      this.debounce(key, () => {
        this.emit("watch-event", {
          type: "region-updated",
          data: regionInfo,
        } as WatchEvent);
      });
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
        // Also notify about this specific tile
        this.debounce(`tile-${tileInfo.lod}-${tileInfo.tileX}-${tileInfo.tileY}`, () => {
          this.emit("watch-event", {
            type: "tile-updated",
            data: tileInfo,
          } as WatchEvent);
        });
      }
    }

    if (rel.endsWith(".region")) {
      const regionInfo = this.parseRegionPath(rel);
      if (regionInfo) {
        const key = `region-${regionInfo.regionX}-${regionInfo.regionY}`;
        this.debounce(key, () => {
          this.emit("watch-event", {
            type: "region-updated",
            data: regionInfo,
          } as WatchEvent);
        });
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
      this.debounce("surface-index", () => {
        this.emit("watch-event", {
          type: "surface-index-changed",
        } as WatchEvent);
      });
    }
  }

  /**
   * Parse a relative surface file path like "maps/1/2048/768.surface"
   * into { lod, tileX, tileY }.
   */
  private parseSurfacePath(
    rel: string
  ): { lod: number; tileX: number; tileY: number } | null {
    // Expected: maps/{lod}/{worldX}/{worldY}.surface
    const match = rel.match(
      /^maps\/(\d+)\/(\d+)\/(\d+)\.surface$/
    );
    if (!match) return null;

    const lod = parseInt(match[1]);
    const worldX = parseInt(match[2]);
    const worldY = parseInt(match[3]);
    const mapSize = 256;
    const tileX = worldX / (mapSize * lod);
    const tileY = worldY / (mapSize * lod);

    if (!Number.isInteger(tileX) || !Number.isInteger(tileY)) return null;

    return { lod, tileX, tileY };
  }

  /**
   * Parse a relative region file path like "chunks/2/256/384/128.region"
   * into { lod, regionX, regionY }.
   */
  private parseRegionPath(
    rel: string
  ): { lod: number; regionX: number; regionY: number } | null {
    // Expected: chunks/{lod}/{worldX}/{worldY}/{worldZ}.region
    const match = rel.match(/^chunks\/(\d+)\/(-?\d+)\/(-?\d+)\/-?\d+\.region$/);
    if (!match) return null;

    const lod = parseInt(match[1]);
    const regionX = parseInt(match[2]);
    const regionY = parseInt(match[3]);

    if (isNaN(lod) || isNaN(regionX) || isNaN(regionY)) return null;

    return { lod, regionX, regionY };
  }
}
