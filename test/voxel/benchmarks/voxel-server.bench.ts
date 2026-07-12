import { after, test } from "node:test";
import { sampleSerial } from "../support/benchmark.js";
import {
  boundaryFixtures,
  colors,
  EMITTER,
  REGION_SIZE,
  shapes,
  stonePlane,
  withTemporarySave,
  writeAdjacentFixture,
  writeBoundaryFixture,
  writeRegions,
  writeSurface,
} from "../support/fixture-world.js";
import {
  cleanupVoxelCache,
  generateLod1,
  generateVoxelMesh,
  VoxelEmitterSummaryService,
} from "../support/production.js";

after(cleanupVoxelCache);

test("benchmark server baseline generation", async () => {
  await withTemporarySave("bench-baseline", async (save) => {
    await writeSurface(save);
    await writeRegions(save, [
      ...stonePlane(),
      { x: 64, y: 64, z: 1, type: EMITTER },
    ]);
    const baseline = await generateLod1(save, colors, shapes);
    await sampleSerial("server-baseline", async () => {
      await generateLod1(save, colors, shapes);
    });
    console.log(
      JSON.stringify({
        benchmark: "server-baseline-structure",
        payloadBytes: baseline.buffer.byteLength,
        metrics: baseline.stats,
      }),
    );
  });
});

test("benchmark server dense halo and cap pressure", async () => {
  await withTemporarySave("bench-dense", async (save) => {
    const denseFixture = boundaryFixtures.find(
      (fixture) => fixture.name === "dense-both-sides",
    );
    if (!denseFixture) throw new Error("dense boundary fixture is missing");
    await writeBoundaryFixture(save, denseFixture, true);
    const baseline = await generateLod1(save, colors, shapes);
    await sampleSerial("server-dense-halo-cap", async () => {
      await generateLod1(save, colors, shapes);
    });
    console.log(
      JSON.stringify({
        benchmark: "server-dense-halo-cap-structure",
        payloadBytes: baseline.buffer.byteLength,
        emitterRecords: baseline.stats.emitterRecords,
        metrics: baseline.stats,
      }),
    );
  });
});

test("benchmark server adjacent region access", async () => {
  await withTemporarySave("bench-adjacent", async (save) => {
    await writeAdjacentFixture(save, true);
    const baseline = await generateLod1(save, colors, shapes, REGION_SIZE, 0);
    await sampleSerial("server-adjacent-region", async () => {
      await generateLod1(save, colors, shapes, REGION_SIZE, 0);
    });
    console.log(
      JSON.stringify({
        benchmark: "server-adjacent-region-structure",
        payloadBytes: baseline.buffer.byteLength,
        externalRegionParses: baseline.stats.externalRegionParses,
        externalRegionCacheHits: baseline.stats.externalRegionCacheHits,
        metrics: baseline.stats,
      }),
    );
  });
});

test("benchmark server coarse summary generation", async () => {
  await withTemporarySave("bench-coarse", async (save) => {
    await writeSurface(save);
    await writeRegions(save, [
      ...stonePlane(),
      { x: 64, y: 64, z: 1, type: EMITTER },
    ]);
    await writeSurface(save, 2);
    await writeRegions(
      save,
      stonePlane(REGION_SIZE * 2, REGION_SIZE * 2, 2),
      2,
    );
    const summaries = new VoxelEmitterSummaryService(save, colors, shapes);
    const summary = await summaries.getNode(2, 0, 0);
    const baseline = await generateVoxelMesh(save, colors, shapes, 2, 0, 0, {
      emitterSummary: summary.node,
      emitterSummaryMetrics: summary.metrics,
    });
    if (!baseline.buffer || !baseline.stats) {
      throw new Error("coarse benchmark payload metrics missing");
    }
    await sampleSerial("server-coarse-summary", async () => {
      await generateVoxelMesh(save, colors, shapes, 2, 0, 0, {
        emitterSummary: summary.node,
        emitterSummaryMetrics: summary.metrics,
      });
    });
    console.log(
      JSON.stringify({
        benchmark: "server-coarse-summary-structure",
        payloadBytes: baseline.buffer.byteLength,
        summaryClusters: summary.node.clusters.length,
        metrics: baseline.stats,
      }),
    );
  });
});
