import assert from "node:assert/strict";
import { test } from "node:test";

import type { QueryClient } from "@tanstack/react-query";

import {
  handleTerrainTileUpdate,
  handleVoxelRegionUpdate,
} from "../../../src/client/features/world-view/lib/live-updates.js";
import { terrainTileKey } from "../../../src/client/features/world-view/lib/terrain-manager.js";
import type {
  LoadedTerrainTile,
  PendingVoxelFetchRequest,
  PendingVoxelMeshItem,
} from "../../../src/client/features/world-view/lib/types.js";
import { voxelTileKey } from "../../../src/client/features/world-view/lib/voxel-index.js";
import type { VoxelWorkPriority } from "../../../src/client/features/world-view/lib/voxel-work.js";

function queryClientRecorder(): { client: QueryClient; keys: unknown[][] } {
  const keys: unknown[][] = [];
  return {
    client: {
      invalidateQueries: ({ queryKey }: { queryKey?: unknown[] }) => {
        if (queryKey) keys.push(queryKey);
        return Promise.resolve();
      },
    } as QueryClient,
    keys,
  };
}

test("terrain changes evict the complete gutter neighborhood and reload only when enabled", () => {
  const { client, keys } = queryClientRecorder();
  const loaded = new Map<string, LoadedTerrainTile>();
  const target = terrainTileKey(2, 3, -1);
  loaded.set(target, { key: target } as LoadedTerrainTile);
  const evicted: string[] = [];
  const disposed: string[] = [];
  const queued: Array<[number, number, number]> = [];
  const args = {
    lod: 2,
    tileX: 3,
    tileY: -1,
    queryClient: client,
    loadedTerrain: loaded,
    evictWarmCachedTerrainTile: (key: string) => evicted.push(key),
    queueTerrainTileLoad: (lod: number, x: number, y: number) =>
      queued.push([lod, x, y]),
    disposeTerrainTile: (tile: LoadedTerrainTile) => disposed.push(tile.key),
    debugLabelsDirtyRef: { current: false },
    biomeLabelsDirtyRef: { current: false },
  };

  handleTerrainTileUpdate({ ...args, showTerrainUnderlay: false });
  assert.equal(evicted.length, 9);
  assert.equal(queued.length, 0);
  assert.deepEqual(disposed, [target]);
  assert.equal(loaded.size, 0);
  assert.equal(keys.filter(([kind]) => kind === "terrain").length, 9);
  assert.ok(keys.some((key) => key.join("/") === "biomes/2/3/-1"));

  handleTerrainTileUpdate({ ...args, showTerrainUnderlay: true });
  assert.equal(queued.length, 9);
});

test("voxel changes floor-align negative halo leaves and ancestors while cancelling stale work", () => {
  const priority: VoxelWorkPriority = {
    coverageClass: "detail",
    viewClass: "forward",
    projectedBenefit: 1,
    distance: 1,
    lod: 1,
    generation: 0,
  };
  const staleVersions = new Map<string, number>();
  const affectedKey = voxelTileKey(1, -256, -128);
  const unrelatedKey = voxelTileKey(1, 512, 0);
  const controller = new AbortController();
  const fetchQueue: PendingVoxelFetchRequest[] = [
    {
      key: affectedKey,
      lod: 1,
      regionX: -256,
      regionY: -128,
      priority,
      generation: 0,
      version: 0,
      selectedAt: 0,
    },
    {
      key: unrelatedKey,
      lod: 1,
      regionX: 512,
      regionY: 0,
      priority,
      generation: 0,
      version: 0,
      selectedAt: 0,
    },
  ];
  const meshQueue: PendingVoxelMeshItem[] = [
    { key: affectedKey, version: 0 },
    { key: unrelatedKey, version: 0 },
  ] as PendingVoxelMeshItem[];
  const fetchQueueRef = { current: fetchQueue };
  const meshQueueRef = { current: meshQueue };
  const refreshed: Array<{
    lod: number;
    regionX: number;
    regionY: number;
    version: number;
  }> = [];
  const available = new Set([affectedKey, voxelTileKey(32, -4096, -4096)]);
  const missing = new Set([affectedKey]);
  const failed = new Map([[affectedKey, Date.now()]]);
  const loading = new Set([affectedKey]);
  const fetchControllers = new Map([[affectedKey, controller]]);

  handleVoxelRegionUpdate({
    lod: 1,
    regionX: -128,
    regionY: 0,
    scene: null,
    loadedVoxels: new Map(),
    availableVoxelKeys: available,
    missingVoxels: missing,
    failedVoxels: failed,
    loadingVoxels: loading,
    voxelFetchControllers: fetchControllers,
    pendingVoxelFetchQueueRef: fetchQueueRef,
    pendingVoxelMeshQueueRef: meshQueueRef,
    markVoxelTileStale: (key) => {
      const version = (staleVersions.get(key) ?? 0) + 1;
      staleVersions.set(key, version);
      return version;
    },
    getVoxelRefreshVersion: (key) => staleVersions.get(key) ?? 0,
    evictWarmCachedVoxelTile: () => {},
    requestDirectVoxelRefresh: (lod, regionX, regionY, version) =>
      refreshed.push({ lod, regionX, regionY, version }),
    checkAndUpdateLOD: () => {},
    debugLabelsDirtyRef: { current: false },
    biomeLabelsDirtyRef: { current: false },
  });

  assert.equal(controller.signal.aborted, true);
  assert.equal(fetchQueueRef.current.length, 1);
  assert.equal(fetchQueueRef.current[0]?.key, unrelatedKey);
  assert.equal(meshQueueRef.current.length, 1);
  assert.equal(meshQueueRef.current[0]?.key, unrelatedKey);
  assert.equal(missing.has(affectedKey), false);
  assert.equal(failed.has(affectedKey), false);
  assert.equal(loading.has(affectedKey), false);
  assert.ok(staleVersions.has(voxelTileKey(1, -256, -128)));
  assert.ok(staleVersions.has(voxelTileKey(1, 0, 128)));
  assert.ok(staleVersions.has(voxelTileKey(2, -256, -256)));
  assert.ok(staleVersions.has(voxelTileKey(32, -4096, -4096)));
  assert.equal(
    refreshed.length,
    2,
    "only loaded or available tiles refresh directly",
  );
  assert.equal(
    new Set(
      refreshed.map((item) => `${item.lod}/${item.regionX}/${item.regionY}`),
    ).size,
    2,
  );
});
