import assert from "node:assert/strict";
import { after, test } from "node:test";

import {
  colors,
  EMITTER,
  MODEL,
  REGION_SIZE,
  STONE,
  shapes,
  stonePlane,
  withTemporarySave,
  writeRegions,
  writeSurface,
} from "../support/fixture-world.js";
import { decodeEmitterRecords } from "../support/payload-records.js";
import {
  cleanupVoxelCache,
  generateVoxelMesh,
  VoxelEmitterSummaryService,
} from "../support/production.js";

after(cleanupVoxelCache);

test("server omits hidden, depth-suppressed, and empty-model emitters", async () => {
  await withTemporarySave("unrepresented", async (save) => {
    await writeSurface(save);
    await writeRegions(save, [
      { x: 32, y: 32, z: 0, type: EMITTER },
      { x: 31, y: 32, z: 0, type: STONE },
      { x: 33, y: 32, z: 0, type: STONE },
      { x: 32, y: 31, z: 0, type: STONE },
      { x: 32, y: 33, z: 0, type: STONE },
      { x: 32, y: 32, z: -1, type: STONE },
      { x: 32, y: 32, z: 1, type: STONE },
      { x: 48, y: 48, z: -70, type: EMITTER },
      { x: 64, y: 64, z: 1, type: MODEL },
      { x: 0, y: 0, z: 0, type: STONE },
    ]);
    const result = await generateVoxelMesh(save, colors, shapes, 1, 0, 0, {
      includeHaloEmitters: false,
      returnRepresentedSources: true,
    });
    assert.ok(result.buffer);
    assert.deepEqual(result.representedSources, []);
    assert.deepEqual(decodeEmitterRecords(result.buffer), []);
  });
});

test("server retains qualified detailed sources in production coarse summaries", async () => {
  await withTemporarySave("qualified-coarse", async (save) => {
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
    const detailed = await generateVoxelMesh(save, colors, shapes, 1, 0, 0, {
      includeHaloEmitters: false,
      returnRepresentedSources: true,
    });
    assert.equal(detailed.representedSources?.length, 1);
    const summary = await new VoxelEmitterSummaryService(
      save,
      colors,
      shapes,
    ).getNode(2, 0, 0);
    assert.ok(
      summary.node.clusters.length > 0,
      "production summary contains detailed source",
    );
    const coarse = await generateVoxelMesh(save, colors, shapes, 2, 0, 0, {
      emitterSummary: summary.node,
      emitterSummaryMetrics: summary.metrics,
      includeHaloEmitters: false,
    });
    assert.ok(coarse.buffer);
    assert.ok(
      decodeEmitterRecords(coarse.buffer).length > 0,
      "summary emitter reaches coarse geometry",
    );
  });
});
