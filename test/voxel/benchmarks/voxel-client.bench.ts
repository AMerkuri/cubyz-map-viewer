import { after, test } from "node:test";
import type { EmitterSummaryCluster } from "../../../src/server/services/voxel-emitter-aggregation.js";
import { EMITTER_SUMMARY_FORMAT_VERSION } from "../../../src/server/services/voxel-emitter-aggregation.js";
import { sampleBalancedPair, sampleSerial } from "../support/benchmark.js";
import {
  colors,
  EMITTER,
  REGION_SIZE,
  shapes,
  stonePlane,
  withTemporarySave,
  writeAdjacentFixture,
  writeAdjacentYAxisFixture,
  writeRegions,
  writeSurface,
} from "../support/fixture-world.js";
import {
  cleanupVoxelCache,
  generateLod1,
  generateVoxelMesh,
} from "../support/production.js";
import {
  buildProgressiveWithProductionWorker,
  buildWithProductionWorker,
} from "../support/worker-harness.js";

after(cleanupVoxelCache);

test("benchmark client baseline payload decoding", async () => {
  await withTemporarySave("bench-client-baseline", async (save) => {
    await writeSurface(save);
    await writeRegions(save, [
      ...stonePlane(),
      { x: 64, y: 64, z: 1, type: EMITTER },
    ]);
    const generated = await generateLod1(save, colors, shapes);
    if (!generated.buffer) throw new Error("baseline payload missing");
    const mesh = await buildWithProductionWorker(generated.buffer.slice(0));
    await sampleSerial("client-baseline-decode", async () => {
      await buildWithProductionWorker(generated.buffer.slice(0));
    });
    console.log(
      JSON.stringify({
        benchmark: "client-baseline-decode-structure",
        payloadBytes: generated.buffer.byteLength,
        outputVertices: mesh.quadrantMeshes.reduce(
          (sum, quadrant) => sum + quadrant.positions.length / 3,
          0,
        ),
        emissivePhase: mesh.emissivePhase,
      }),
    );
  });
});

test("benchmark client dense emissive baking", async () => {
  await withTemporarySave("bench-client-dense", async (save) => {
    await writeAdjacentFixture(save, true);
    const generated = await generateLod1(save, colors, shapes);
    if (!generated.buffer) throw new Error("dense payload missing");
    const mesh = await buildWithProductionWorker(generated.buffer.slice(0));
    const onePhaseStart = performance.now();
    const onePhase = await buildWithProductionWorker(generated.buffer.slice(0));
    const onePhaseMs = performance.now() - onePhaseStart;
    const progressive = await buildProgressiveWithProductionWorker(
      generated.buffer.slice(0),
    );
    const [uncached, cached] = await Promise.all([
      buildWithProductionWorker(generated.buffer.slice(0), {
        candidateNeighborhoodMode: "uncached",
      }),
      buildWithProductionWorker(generated.buffer.slice(0), {
        candidateNeighborhoodMode: "cached",
      }),
    ]);
    const candidateComparison = await sampleBalancedPair(
      "client-dense-candidate-neighborhood",
      () =>
        buildWithProductionWorker(generated.buffer.slice(0), {
          candidateNeighborhoodMode: "uncached",
        }).then(() => undefined),
      () =>
        buildWithProductionWorker(generated.buffer.slice(0), {
          candidateNeighborhoodMode: "cached",
        }).then(() => undefined),
    );
    await sampleSerial("client-dense-emissive", async () => {
      await buildWithProductionWorker(generated.buffer.slice(0));
    });
    console.log(
      JSON.stringify({
        benchmark: "client-dense-emissive-structure",
        payloadBytes: generated.buffer.byteLength,
        outputVertices: mesh.quadrantMeshes.reduce(
          (sum, quadrant) => sum + quadrant.positions.length / 3,
          0,
        ),
        emissivePhase: mesh.emissivePhase,
        candidateNeighborhoodComparison: {
          ...candidateComparison,
          byteParity:
            JSON.stringify(
              cached.quadrantMeshes.map((quadrant) => quadrant.emissiveColors),
            ) ===
            JSON.stringify(
              uncached.quadrantMeshes.map(
                (quadrant) => quadrant.emissiveColors,
              ),
            ),
          uncachedMetrics: uncached.emissivePhase,
          cachedMetrics: cached.emissivePhase,
        },
        cachedPayloadComparison: {
          onePhaseMs,
          baseVisibleMs: progressive.baseMs,
          enhancementMs: progressive.enhancementMs,
          progressiveTotalCpuMs: progressive.baseMs + progressive.enhancementMs,
          retainedCompactBytes: progressive.retained?.byteLength ?? 0,
          onePhaseOutputBytes: meshOutputBytes(onePhase),
          progressiveBaseOutputBytes: meshOutputBytes(progressive.base),
          progressiveEnhancementOutputBytes:
            progressive.enhancement?.quadrantEnhancements.reduce(
              (sum, quadrant) => sum + quadrant.emissiveColors.byteLength,
              0,
            ) ?? 0,
        },
      }),
    );
  });
});

function meshOutputBytes(
  mesh: Awaited<ReturnType<typeof buildWithProductionWorker>>,
): number {
  return [...mesh.quadrantMeshes, ...mesh.transparentQuadrantMeshes].reduce(
    (sum, quadrant) =>
      sum +
      quadrant.positions.byteLength +
      quadrant.normals.byteLength +
      quadrant.baseColors.byteLength +
      quadrant.faceAo.byteLength +
      quadrant.trianglePaletteIndices.byteLength +
      quadrant.indices.byteLength +
      (quadrant.emissiveColors?.byteLength ?? 0),
    mesh.chunkTopHeights.byteLength,
  );
}

test("benchmark client adjacent seam pair", async () => {
  await withTemporarySave("bench-client-seam", async (save) => {
    await writeAdjacentFixture(save, true);
    const west = await generateLod1(save, colors, shapes);
    const east = await generateLod1(save, colors, shapes, REGION_SIZE, 0);
    if (!west.buffer || !east.buffer) throw new Error("seam payload missing");
    const [westMesh, eastMesh] = await Promise.all([
      buildWithProductionWorker(west.buffer.slice(0)),
      buildWithProductionWorker(east.buffer.slice(0)),
    ]);
    await sampleSerial("client-adjacent-seam", async () => {
      await buildWithProductionWorker(west.buffer.slice(0));
      await buildWithProductionWorker(east.buffer.slice(0));
    });
    console.log(
      JSON.stringify({
        benchmark: "client-adjacent-seam-structure",
        payloadBytes: west.buffer.byteLength + east.buffer.byteLength,
        outputVertices: [
          ...westMesh.quadrantMeshes,
          ...eastMesh.quadrantMeshes,
        ].reduce((sum, quadrant) => sum + quadrant.positions.length / 3, 0),
        westEmissivePhase: westMesh.emissivePhase,
        eastEmissivePhase: eastMesh.emissivePhase,
      }),
    );
  });
});

test("benchmark candidate-neighborhood decision matrix", async () => {
  const fixtures: Array<{
    name: string;
    buffer: ArrayBuffer;
    candidateCacheMaxBytes?: number;
  }> = [];

  await withTemporarySave("bench-candidate-sparse", async (save) => {
    await writeSurface(save);
    await writeRegions(save, [
      ...stonePlane(),
      { x: 64, y: 64, z: 1, type: EMITTER },
    ]);
    const sparse = await generateLod1(save, colors, shapes);
    if (!sparse.buffer) throw new Error("sparse payload missing");
    fixtures.push({ name: "sparse-own-only-lod1", buffer: sparse.buffer });
    fixtures.push({
      name: "cache-bound-fallback-lod1",
      buffer: sparse.buffer.slice(0),
      candidateCacheMaxBytes: 0,
    });
  });

  await withTemporarySave("bench-candidate-empty", async (save) => {
    await writeSurface(save);
    await writeRegions(save, stonePlane());
    const empty = await generateLod1(save, colors, shapes);
    if (!empty.buffer) throw new Error("empty payload missing");
    fixtures.push({ name: "empty-lod1", buffer: empty.buffer });
  });

  await withTemporarySave("bench-candidate-x-seam", async (save) => {
    await writeAdjacentFixture(save, true);
    const west = await generateLod1(save, colors, shapes);
    const east = await generateLod1(save, colors, shapes, REGION_SIZE, 0);
    if (!west.buffer || !east.buffer) throw new Error("X seam payload missing");
    fixtures.push({ name: "dense-halo-x-seam-west-lod1", buffer: west.buffer });
    fixtures.push({ name: "dense-halo-x-seam-east-lod1", buffer: east.buffer });
  });

  await withTemporarySave("bench-candidate-y-seam", async (save) => {
    await writeAdjacentYAxisFixture(save);
    const south = await generateLod1(save, colors, shapes);
    if (!south.buffer) throw new Error("Y seam payload missing");
    fixtures.push({
      name: "asymmetric-halo-y-seam-lod1",
      buffer: south.buffer,
    });
  });

  await withTemporarySave("bench-candidate-coarse", async (save) => {
    const lod = 2;
    const span = REGION_SIZE * lod;
    await writeSurface(save, lod);
    await writeRegions(save, stonePlane(span * 2, span, lod), lod);
    const result = await generateVoxelMesh(save, colors, shapes, lod, 0, 0, {
      emitterSummary: {
        formatVersion: EMITTER_SUMMARY_FORMAT_VERSION,
        lod,
        regionX: 0,
        regionY: 0,
        sourceSignature: "candidate-comparison-coarse",
        signature: "candidate-comparison-coarse-0",
        rawSourceCount: 2,
        cappedClusterCount: 0,
        clusters: [
          candidateCluster(span - 6, 128, 5, 220, 80, 20),
          candidateCluster(span + 6, 132, 5, 20, 100, 255),
        ],
      },
    });
    if (!result.buffer) throw new Error("coarse payload missing");
    fixtures.push({ name: "coarse-summary-lod2", buffer: result.buffer });
  });

  const results = [];
  for (const fixture of fixtures) {
    results.push(await compareCandidateNeighborhoodFixture(fixture));
  }
  const gate = evaluateCandidateNeighborhoodGate(results);
  console.log(
    JSON.stringify({
      benchmark: "candidate-neighborhood-decision-matrix",
      fixtures: results,
      gate,
    }),
  );
});

async function compareCandidateNeighborhoodFixture(fixture: {
  name: string;
  buffer: ArrayBuffer;
  candidateCacheMaxBytes?: number;
}) {
  const options =
    fixture.candidateCacheMaxBytes === undefined
      ? undefined
      : { candidateCacheMaxBytes: fixture.candidateCacheMaxBytes };
  const [uncached, cached] = await Promise.all([
    buildWithProductionWorker(fixture.buffer.slice(0), {
      candidateNeighborhoodMode: "uncached",
      ...options,
    }),
    buildWithProductionWorker(fixture.buffer.slice(0), {
      candidateNeighborhoodMode: "cached",
      ...options,
    }),
  ]);
  const timings = await sampleBalancedPair(
    `candidate-neighborhood-${fixture.name}`,
    () =>
      buildWithProductionWorker(fixture.buffer.slice(0), {
        candidateNeighborhoodMode: "uncached",
        ...options,
      }).then(() => undefined),
    () =>
      buildWithProductionWorker(fixture.buffer.slice(0), {
        candidateNeighborhoodMode: "cached",
        ...options,
      }).then(() => undefined),
  );
  return {
    name: fixture.name,
    timings,
    receiverReuse: cached.emissivePhase.receiverEvaluations
      ? cached.emissivePhase.cacheHits /
        cached.emissivePhase.receiverEvaluations
      : 0,
    probeReduction:
      cached.emissivePhase.neighborhoodCellProbes === 0
        ? 1
        : uncached.emissivePhase.neighborhoodCellProbes /
          cached.emissivePhase.neighborhoodCellProbes,
    cellProbes: {
      uncached: uncached.emissivePhase.neighborhoodCellProbes,
      cached: cached.emissivePhase.neighborhoodCellProbes,
    },
    rawBucketEntries: {
      uncached: uncached.emissivePhase.rawBucketEntries,
      cached: cached.emissivePhase.rawBucketEntries,
    },
    cacheHitRatio:
      cached.emissivePhase.cacheHits + cached.emissivePhase.cacheMisses === 0
        ? 0
        : cached.emissivePhase.cacheHits /
          (cached.emissivePhase.cacheHits + cached.emissivePhase.cacheMisses),
    peakCacheBytes: cached.emissivePhase.peakAccountedCacheBytes,
    byteParity: meshOutputMatches(uncached, cached),
  };
}

function evaluateCandidateNeighborhoodGate(
  results: Awaited<ReturnType<typeof compareCandidateNeighborhoodFixture>>[],
) {
  const uncachedMedianMs = results.reduce(
    (sum, result) => sum + result.timings.uncached.medianMs,
    0,
  );
  const cachedMedianMs = results.reduce(
    (sum, result) => sum + result.timings.cached.medianMs,
    0,
  );
  const aggregateReduction =
    uncachedMedianMs === 0 ? 0 : 1 - cachedMedianMs / uncachedMedianMs;
  return {
    aggregateReduction,
    aggregateProbeReduction:
      results.reduce((sum, result) => sum + result.cellProbes.uncached, 0) /
      results.reduce((sum, result) => sum + result.cellProbes.cached, 0),
    noStableRegression: results.every(
      (result) =>
        result.timings.cached.medianMs <=
        result.timings.uncached.medianMs * 1.1,
    ),
    byteParity: results.every((result) => result.byteParity),
    boundedMemory: results.every(
      (result) => result.peakCacheBytes <= 16 * 1024 * 1024,
    ),
  };
}

function meshOutputMatches(
  left: Awaited<ReturnType<typeof buildWithProductionWorker>>,
  right: Awaited<ReturnType<typeof buildWithProductionWorker>>,
): boolean {
  return (
    JSON.stringify(left.emitterRecords) ===
      JSON.stringify(right.emitterRecords) &&
    JSON.stringify(left.quadrantMeshes) ===
      JSON.stringify(right.quadrantMeshes) &&
    JSON.stringify(left.transparentQuadrantMeshes) ===
      JSON.stringify(right.transparentQuadrantMeshes)
  );
}

function candidateCluster(
  centroidX: number,
  centroidY: number,
  centroidZ: number,
  powerR: number,
  powerG: number,
  powerB: number,
): EmitterSummaryCluster {
  return {
    centroidX,
    centroidY,
    centroidZ,
    powerR,
    powerG,
    powerB,
    centroidWeight: 1,
    sourceCount: 1,
    openFaces: 0b11_1111,
    minX: centroidX - 0.5,
    minY: centroidY - 0.5,
    minZ: centroidZ - 0.5,
    maxX: centroidX + 0.5,
    maxY: centroidY + 0.5,
    maxZ: centroidZ + 0.5,
    representedLods: 1,
  };
}
