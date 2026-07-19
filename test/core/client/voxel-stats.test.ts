import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addVoxelBenchmarkSample,
  createEmptyVoxelBenchmarkStats,
} from "../../../src/client/features/world-view/lib/stats.js";
import type { WorkerMeshResult } from "../../../src/client/features/world-view/lib/types.js";

function sample(
  optional: Partial<NonNullable<WorkerMeshResult["benchmark"]>>,
): NonNullable<WorkerMeshResult["benchmark"]> {
  return {
    fetchCompletedAt: 0,
    fetchMs: 10,
    decodeMs: 20,
    totalMs: 30,
    transferBytes: 1,
    encodedBodyBytes: 2,
    decodedBodyBytes: 3,
    rawBufferBytes: 4,
    workerOutputBytes: 5,
    emissiveBytes: 6,
    emissiveSkipped: false,
    emissiveGridBuildMs: null,
    emissiveBakeMs: null,
    emissiveQuadsEvaluated: 7,
    emissiveQuadsCulled: 8,
    emissiveReceiverEvaluations: 9,
    emissiveNeighborhoodCellProbes: 10,
    emissiveNonEmptyBuckets: 11,
    emissiveRawBucketEntries: 12,
    emissiveDeduplicatedNeighborhoodEntries: 13,
    emissiveCandidateVisits: 9,
    emissiveCacheHits: 0,
    emissiveCacheMisses: 0,
    emissiveCacheEntries: 0,
    emissiveUncachedFallbacks: 0,
    emissivePeakAccountedCacheBytes: 0,
    contentEncoding: "br",
    serverRunMs: null,
    serverHaloMs: null,
    emitterMetadataBytes: 10,
    emitterPowerMin: 1,
    emitterPowerMax: 2,
    emitterRadiusMin: 3,
    emitterRadiusMax: 4,
    ...optional,
  };
}

test("sparse optional benchmark averages use independent valid samples", () => {
  let stats = createEmptyVoxelBenchmarkStats(true, true);
  stats = addVoxelBenchmarkSample(stats, sample({ serverRunMs: 12 }));
  stats = addVoxelBenchmarkSample(
    stats,
    sample({
      fetchMs: 20,
      serverHaloMs: 8,
      emissiveGridBuildMs: 4,
      emissiveBakeMs: 6,
    }),
  );

  assert.equal(stats.samples, 2);
  assert.equal(stats.avgFetchMs, 15);
  assert.equal(stats.avgServerRunMs, 12);
  assert.equal(stats.avgServerHaloMs, 8);
  assert.equal(stats.avgEmissiveGridBuildMs, 4);
  assert.equal(stats.avgEmissiveBakeMs, 6);
  assert.deepEqual(stats.validSamples, {
    emissiveGridBuild: 1,
    emissiveBake: 1,
    serverRun: 1,
    serverHalo: 1,
  });
});

test("progressive benchmark output preserves base, enhancement, and combined bytes", () => {
  const stats = addVoxelBenchmarkSample(
    createEmptyVoxelBenchmarkStats(true, true),
    sample({
      workerOutputBytes: 250_000,
      baseWorkerOutputBytes: 10 * 1024 * 1024,
      enhancementWorkerOutputBytes: 250_000,
      combinedWorkerOutputBytes: 10 * 1024 * 1024 + 250_000,
    }),
  );

  assert.equal(stats.avgBaseWorkerOutputBytes, 10 * 1024 * 1024);
  assert.equal(stats.avgEnhancementWorkerOutputBytes, 250_000);
  assert.equal(stats.avgCombinedWorkerOutputBytes, 10 * 1024 * 1024 + 250_000);
});
