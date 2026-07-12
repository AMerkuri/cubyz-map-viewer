import assert from "node:assert/strict";
import { after, test } from "node:test";

import {
  colors,
  REGION_SIZE,
  samePoint,
  shapes,
  withTemporarySave,
  writeAdjacentFixture,
} from "../support/fixture-world.js";
import { decodeEmitterRecords } from "../support/payload-records.js";
import { cleanupVoxelCache, generateLod1 } from "../support/production.js";
import { collectSeamEmissive, maxSeamDelta } from "../support/seam-colors.js";
import { buildWithProductionWorker } from "../support/worker-harness.js";

after(cleanupVoxelCache);

for (const pressure of [false, true]) {
  test(`contract LOD1 seam colors ${pressure ? "under cap pressure" : "uncapped"}`, async () => {
    await withTemporarySave(
      `contract-lod1-${pressure ? "capped" : "uncapped"}`,
      async (save) => {
        const required = await writeAdjacentFixture(save, pressure);
        const west = await generateLod1(save, colors, shapes);
        const east = await generateLod1(save, colors, shapes, REGION_SIZE, 0);
        assert.ok(west.buffer && east.buffer);
        const westRecords = decodeEmitterRecords(west.buffer);
        const eastRecords = decodeEmitterRecords(east.buffer).map((record) => ({
          ...record,
          x: record.x + REGION_SIZE,
        }));
        for (const source of required) {
          assert.ok(
            westRecords.some((record) => samePoint(record, source)),
            `west retains required source ${source.y}/${source.z}`,
          );
          assert.ok(
            eastRecords.some((record) => samePoint(record, source)),
            `east retains required source ${source.y}/${source.z}`,
          );
        }
        const [westMesh, eastMesh] = await Promise.all([
          buildWithProductionWorker(west.buffer.slice(0)),
          buildWithProductionWorker(east.buffer.slice(0)),
        ]);
        const seam = maxSeamDelta(
          collectSeamEmissive(westMesh, REGION_SIZE),
          collectSeamEmissive(eastMesh, REGION_SIZE),
        );
        assert.ok(
          seam.count > 0,
          "matching seam vertices are identified by world position and normal",
        );
        assert.ok(
          seam.delta <= 1 / 255,
          `normalized seam delta ${seam.delta} is within one compact encoding step`,
        );
      },
    );
  });
}
