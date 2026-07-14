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
    fetchMs: 10,
    decodeMs: 20,
    totalMs: 30,
    transferBytes: 1,
    encodedBodyBytes: 2,
    decodedBodyBytes: 3,
    rawBufferBytes: 4,
    workerOutputBytes: 5,
    emissiveBytes: 6,
    emissiveGridBuildMs: null,
    emissiveBakeMs: null,
    emissiveQuadsEvaluated: 7,
    emissiveQuadsCulled: 8,
    emissiveCandidateVisits: 9,
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
