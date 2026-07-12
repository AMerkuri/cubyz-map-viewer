import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import {
  SaveWatcher,
  type SaveWatcherScheduler,
  type WatchEvent,
} from "../../../src/server/services/watcher.js";

class ManualScheduler implements SaveWatcherScheduler {
  private nextId = 1;
  private readonly callbacks = new Map<number, () => void>();

  setTimeout(callback: () => void): NodeJS.Timeout {
    const id = this.nextId++;
    this.callbacks.set(id, callback);
    return id as unknown as NodeJS.Timeout;
  }

  clearTimeout(timer: NodeJS.Timeout): void {
    this.callbacks.delete(timer as unknown as number);
  }

  flush(): void {
    while (this.callbacks.size > 0) {
      const callbacks = [...this.callbacks.values()];
      this.callbacks.clear();
      for (const callback of callbacks) callback();
    }
  }
}

function createWatcher(): {
  watcher: SaveWatcher;
  scheduler: ManualScheduler;
  events: WatchEvent[];
  path: (...parts: string[]) => string;
} {
  const scheduler = new ManualScheduler();
  const watcher = new SaveWatcher("/fixture-save", {
    terrainUpdateBatchMs: 0,
    scheduler,
  });
  const events: WatchEvent[] = [];
  watcher.on("watch-event", (event) => events.push(event as WatchEvent));
  return {
    watcher,
    scheduler,
    events,
    path: (...parts) => join("/fixture-save", ...parts),
  };
}

test("surface lifecycle paths emit aligned negative tiles and index updates", () => {
  for (const event of ["change", "add", "unlink"] as const) {
    const { watcher, scheduler, events, path } = createWatcher();
    watcher.handleFileEvent(event, path("maps", "1", "-256", "0.surface"));
    scheduler.flush();
    const batch = events.find(({ type }) => type === "terrain-updates-batch");
    assert.deepEqual(batch?.data, {
      tiles: [{ lod: 1, tileX: -1, tileY: 0 }],
      regions: [],
    });
    if (event === "change") assert.equal(events.length, 1);
    else assert.ok(events.some(({ type }) => type === "surface-index-changed"));
  }
});

test("region lifecycle paths collapse vertical columns and reject invalid layouts", () => {
  const { watcher, scheduler, events, path } = createWatcher();
  for (const event of ["change", "add", "unlink"] as const) {
    watcher.handleFileEvent(
      event,
      path("chunks", "2", "256", "-256", "0.region"),
    );
    watcher.handleFileEvent(
      event,
      path("chunks", "2", "256", "-256", "256.region"),
    );
  }
  watcher.handleFileEvent("change", path("maps", "3", "0", "0.surface"));
  watcher.handleFileEvent("change", path("maps", "1", "1", "0.surface"));
  watcher.handleFileEvent(
    "change",
    path("chunks", "2", "128", "0", "0.region"),
  );
  watcher.handleFileEvent("unlink", path("invalid", "1", "0.surface"));
  scheduler.flush();
  assert.deepEqual(events, [
    {
      type: "terrain-updates-batch",
      data: { tiles: [], regions: [{ lod: 2, regionX: 256, regionY: -256 }] },
    },
  ]);
});

test("debounces player and world events, batches mixed terrain work, and clears pending work on stop", () => {
  const { watcher, scheduler, events, path } = createWatcher();
  watcher.handleFileEvent("change", path("players", "one.json"));
  watcher.handleFileEvent("change", path("players", "two.json"));
  watcher.handleFileEvent("change", path("world.zig.zon"));
  watcher.handleFileEvent("change", path("world.zig.zon"));
  watcher.handleFileEvent("change", path("maps", "1", "0", "0.surface"));
  watcher.handleFileEvent("change", path("chunks", "1", "0", "0", "0.region"));
  scheduler.flush();
  assert.equal(
    events.filter(({ type }) => type === "players-updated").length,
    1,
  );
  assert.equal(events.filter(({ type }) => type === "world-updated").length, 1);
  assert.deepEqual(
    events.find(({ type }) => type === "terrain-updates-batch")?.data,
    {
      tiles: [{ lod: 1, tileX: 0, tileY: 0 }],
      regions: [{ lod: 1, regionX: 0, regionY: 0 }],
    },
  );

  watcher.handleFileEvent("change", path("maps", "1", "0", "0.surface"));
  watcher.stop();
  scheduler.flush();
  assert.equal(events.length, 3);
});
