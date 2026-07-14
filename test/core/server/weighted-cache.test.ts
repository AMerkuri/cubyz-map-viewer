import assert from "node:assert/strict";
import { test } from "node:test";
import { WeightedLRUCache } from "../../../src/server/services/cache.js";
import {
  DEFAULT_VOXEL_EMITTER_SUMMARY_CACHE_BYTES,
  DEFAULT_VOXEL_EMITTER_SUMMARY_CACHE_SIZE,
  DEFAULT_VOXEL_MEMORY_CACHE_BYTES,
  DEFAULT_VOXEL_MEMORY_CACHE_SIZE,
  DEFAULT_VOXEL_WORKER_EMITTER_CACHE_SIZE,
  DEFAULT_VOXEL_WORKER_EMITTER_CACHE_SOURCES,
  readVoxelMemoryCacheConfig,
} from "../../../src/server/services/voxel-memory-config.js";

test("weighted cache evicts least-recently-used entries and accounts replacements", () => {
  const cache = new WeightedLRUCache<string, number>(3, 10, (value) => value);
  cache.set("a", 4);
  cache.set("b", 4);
  assert.equal(cache.get("a"), 4);
  cache.set("c", 4);
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.weight, 8);
  assert.equal(cache.evictions, 1);

  cache.set("a", 2);
  assert.equal(cache.weight, 6);
  cache.delete("c");
  assert.equal(cache.weight, 2);
  cache.clear();
  assert.equal(cache.weight, 0);
});

test("weighted cache declines oversized entries without evicting retained entries", () => {
  const cache = new WeightedLRUCache<string, number>(3, 10, (value) => value);
  cache.set("retained", 4);
  assert.equal(cache.set("oversized", 11), false);
  assert.equal(cache.get("retained"), 4);
  assert.equal(cache.weight, 4);
  assert.equal(cache.oversizedSkips, 1);
});

test("buffer weighting counts shared backing storage once and variant growth exactly", () => {
  interface Entry {
    buffers: Buffer[];
  }
  const cache = new WeightedLRUCache<string, Entry>(2, 12, (entry) => {
    const backingStores = new Set(entry.buffers.map((buffer) => buffer.buffer));
    return [...backingStores].reduce(
      (sum, buffer) => sum + buffer.byteLength,
      0,
    );
  });
  const raw = Buffer.allocUnsafeSlow(8);
  const entry = { buffers: [raw, raw] };
  cache.set("mesh", entry);
  assert.equal(cache.weight, 8);

  entry.buffers.push(Buffer.allocUnsafeSlow(4));
  cache.set("mesh", entry);
  assert.equal(cache.weight, 12);
});

test("voxel memory cache configuration uses only positive integer values", () => {
  assert.deepEqual(readVoxelMemoryCacheConfig({}), {
    entryLimit: DEFAULT_VOXEL_MEMORY_CACHE_SIZE,
    byteLimit: DEFAULT_VOXEL_MEMORY_CACHE_BYTES,
    workerEmitterEntryLimit: DEFAULT_VOXEL_WORKER_EMITTER_CACHE_SIZE,
    workerEmitterSourceLimit: DEFAULT_VOXEL_WORKER_EMITTER_CACHE_SOURCES,
    emitterSummaryEntryLimit: DEFAULT_VOXEL_EMITTER_SUMMARY_CACHE_SIZE,
    emitterSummaryByteLimit: DEFAULT_VOXEL_EMITTER_SUMMARY_CACHE_BYTES,
    recycleHeapBytes: undefined,
    recycleExternalBytes: undefined,
    recycleArrayBufferBytes: undefined,
    recycleCompletedJobs: undefined,
  });
  for (const invalid of ["0", "-1", "1.5", "nope", "Infinity"]) {
    const config = readVoxelMemoryCacheConfig({
      VOXEL_MEMORY_CACHE_SIZE: invalid,
      VOXEL_MEMORY_CACHE_BYTES: invalid,
      VOXEL_EMITTER_SUMMARY_CACHE_SIZE: invalid,
      VOXEL_EMITTER_SUMMARY_CACHE_BYTES: invalid,
    });
    assert.equal(config.entryLimit, DEFAULT_VOXEL_MEMORY_CACHE_SIZE);
    assert.equal(config.byteLimit, DEFAULT_VOXEL_MEMORY_CACHE_BYTES);
    assert.equal(
      config.emitterSummaryEntryLimit,
      DEFAULT_VOXEL_EMITTER_SUMMARY_CACHE_SIZE,
    );
    assert.equal(
      config.emitterSummaryByteLimit,
      DEFAULT_VOXEL_EMITTER_SUMMARY_CACHE_BYTES,
    );
    assert.equal(
      config.workerEmitterEntryLimit,
      DEFAULT_VOXEL_WORKER_EMITTER_CACHE_SIZE,
    );
    assert.equal(
      config.workerEmitterSourceLimit,
      DEFAULT_VOXEL_WORKER_EMITTER_CACHE_SOURCES,
    );
  }
  assert.deepEqual(
    readVoxelMemoryCacheConfig({
      VOXEL_MEMORY_CACHE_SIZE: "7",
      VOXEL_MEMORY_CACHE_BYTES: "4096",
      VOXEL_WORKER_EMITTER_CACHE_SIZE: "8",
      VOXEL_WORKER_EMITTER_CACHE_SOURCES: "512",
      VOXEL_EMITTER_SUMMARY_CACHE_SIZE: "32",
      VOXEL_EMITTER_SUMMARY_CACHE_BYTES: "8192",
      VOXEL_WORKER_RECYCLE_HEAP_BYTES: "1048576",
      VOXEL_WORKER_RECYCLE_EXTERNAL_BYTES: "2097152",
      VOXEL_WORKER_RECYCLE_ARRAY_BUFFER_BYTES: "524288",
      VOXEL_WORKER_RECYCLE_JOBS: "100",
    }),
    {
      entryLimit: 7,
      byteLimit: 4096,
      workerEmitterEntryLimit: 8,
      workerEmitterSourceLimit: 512,
      emitterSummaryEntryLimit: 32,
      emitterSummaryByteLimit: 8192,
      recycleHeapBytes: 1048576,
      recycleExternalBytes: 2097152,
      recycleArrayBufferBytes: 524288,
      recycleCompletedJobs: 100,
    },
  );
});
