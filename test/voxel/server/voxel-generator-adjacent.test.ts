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

after(cleanupVoxelCache);

for (const pressure of [false, true]) {
  test(`server adjacent LOD1 halo membership and metrics ${pressure ? "under cap pressure" : "uncapped"}`, async () => {
    await withTemporarySave(
      `adjacent-${pressure ? "capped" : "uncapped"}`,
      async (save) => {
        const required = await writeAdjacentFixture(save, pressure);
        const west = await generateLod1(save, colors, shapes, 0, 0);
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
            `west retains ${source.x}/${source.y}/${source.z}`,
          );
          assert.ok(
            eastRecords.some((record) => samePoint(record, source)),
            `east retains ${source.x}/${source.y}/${source.z}`,
          );
        }
        assert.ok(
          (west.stats.externalRegionParses ?? 0) +
            (east.stats.externalRegionParses ?? 0) >
            0,
          "adjacent fixtures parse external regions",
        );
        assert.equal(
          (west.stats.externalRegionParseErrors ?? 0) +
            (east.stats.externalRegionParseErrors ?? 0),
          0,
          "external regions parse cleanly",
        );
        assert.ok(
          west.stats.rawPayloadBytes > 0 && east.stats.rawPayloadBytes > 0,
          "payload metrics are populated",
        );
        assert.ok(
          (west.stats.externalRegionCacheHits ?? 0) +
            (east.stats.externalRegionCacheHits ?? 0) >
            0,
          "neighbor access reuses parsed external regions",
        );
      },
    );
  });
}
