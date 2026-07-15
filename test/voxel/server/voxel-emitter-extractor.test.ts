import assert from "node:assert/strict";
import { after, test } from "node:test";

import {
  colors,
  shapes,
  withTemporarySave,
  writeEmptyEmitterFixture,
  writePopulatedEmitterFixture,
} from "../support/fixture-world.js";
import {
  cleanupVoxelCache,
  extractLod1RepresentedEmitters,
  generateVoxelMesh,
  VoxelEmitterSummaryService,
} from "../support/production.js";

after(cleanupVoxelCache);

const POPULATED_BASELINE = [
  {
    x: 0,
    y: 72,
    z: 1,
    r: 255,
    g: 80,
    b: 20,
    openFaces: 31,
    representedLods: 63,
  },
  {
    x: 40,
    y: 40,
    z: 1,
    r: 255,
    g: 80,
    b: 20,
    openFaces: 23,
    representedLods: 63,
  },
  {
    x: 64,
    y: 64,
    z: 1,
    r: 40,
    g: 220,
    b: 80,
    openFaces: 31,
    representedLods: 1,
  },
] as const;

function compareSources(
  left: { x: number; y: number; z: number },
  right: { x: number; y: number; z: number },
): number {
  return left.x - right.x || left.y - right.y || left.z - right.z;
}

test("full-mesh represented sources retain the literal populated-column baseline", async () => {
  await withTemporarySave("emitter-baseline", async (save) => {
    await writePopulatedEmitterFixture(save);
    const generated = await generateVoxelMesh(save, colors, shapes, 1, 0, 0, {
      includeHaloEmitters: false,
      returnRepresentedSources: true,
    });
    assert.deepEqual(
      generated.representedSources?.sort(compareSources),
      POPULATED_BASELINE,
    );
  });
});

test("lightweight extraction matches represented sources without producing a mesh", async () => {
  await withTemporarySave("emitter-extractor", async (save) => {
    await writePopulatedEmitterFixture(save);
    const extracted = await extractLod1RepresentedEmitters(
      save,
      colors,
      shapes,
      0,
      0,
    );
    assert.deepEqual(extracted.sources, POPULATED_BASELINE);
    assert.equal(extracted.metrics.sourceCount, POPULATED_BASELINE.length);
    assert.equal(extracted.metrics.chunksInspected, 17);
    assert.equal(extracted.metrics.regionsParsed, 2);
    assert.ok(extracted.metrics.elapsedMs >= 0);
    assert.equal("buffer" in extracted, false);
  });
});

test("lightweight extraction and summary leaves preserve empty emitter results", async () => {
  await withTemporarySave("emitter-empty", async (save) => {
    await writeEmptyEmitterFixture(save);
    const extracted = await extractLod1RepresentedEmitters(
      save,
      colors,
      shapes,
      0,
      0,
    );
    assert.deepEqual(extracted.sources, []);
    assert.equal(extracted.metrics.sourceCount, 0);

    const summary = await new VoxelEmitterSummaryService(
      save,
      colors,
      shapes,
    ).getNode(1, 0, 0);
    assert.deepEqual(summary.node.clusters, []);
    assert.equal(summary.node.rawSourceCount, 0);
  });
});

test("summary leaves retain literal source identity before clustering", async () => {
  await withTemporarySave("emitter-summary", async (save) => {
    await writePopulatedEmitterFixture(save);
    const summary = await new VoxelEmitterSummaryService(
      save,
      colors,
      shapes,
    ).getNode(1, 0, 0);
    assert.equal(summary.node.rawSourceCount, POPULATED_BASELINE.length);
    assert.deepEqual(
      summary.node.clusters
        .map((cluster) => ({
          x: cluster.minX,
          y: cluster.minY,
          z: cluster.minZ,
          openFaces: cluster.openFaces,
          representedLods: cluster.representedLods,
        }))
        .sort(compareSources),
      POPULATED_BASELINE.map((source) => ({
        x: source.x,
        y: source.y,
        z: source.z,
        openFaces: source.openFaces,
        representedLods: source.representedLods,
      })),
    );
  });
});
