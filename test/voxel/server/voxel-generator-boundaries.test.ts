import assert from "node:assert/strict";
import { after, test } from "node:test";

import {
  boundaryFixtures,
  colors,
  EMITTER_CAP,
  samePoint,
  shapes,
  withTemporarySave,
  writeBoundaryFixture,
} from "../support/fixture-world.js";
import {
  compareRecords,
  decodeEmitterRecords,
  normalizedPayloadBytes,
  recordKey,
} from "../support/payload-records.js";
import { cleanupVoxelCache, generateLod1 } from "../support/production.js";
import { hasLightAt } from "../support/seam-colors.js";

after(cleanupVoxelCache);

for (const fixture of boundaryFixtures) {
  for (const pressure of [false, true]) {
    test(`server boundary ${fixture.name} ${pressure ? "cap-pressure" : "uncapped"}`, async () => {
      await withTemporarySave(
        `${fixture.name}-${pressure ? "capped" : "uncapped"}`,
        async (save) => {
          const expectedHalo = await writeBoundaryFixture(
            save,
            fixture,
            pressure,
          );
          const first = await generateLod1(save, colors, shapes);
          const second = await generateLod1(save, colors, shapes);
          assert.ok(first.buffer && second.buffer);
          const firstRecords = decodeEmitterRecords(first.buffer);
          const secondRecords = decodeEmitterRecords(second.buffer);
          assert.deepEqual(
            firstRecords,
            secondRecords,
            "emitter order is deterministic",
          );
          assert.deepEqual(
            normalizedPayloadBytes(first.buffer),
            normalizedPayloadBytes(second.buffer),
            "payload bytes are deterministic",
          );
          assert.equal(
            new Set(firstRecords.map(recordKey)).size,
            firstRecords.length,
            "emitter records are unique",
          );
          const halo = firstRecords.filter((record) => record.halo);
          if (pressure) {
            assert.equal(
              firstRecords.length,
              EMITTER_CAP,
              "cap is filled exactly",
            );
            for (const source of fixture.halo)
              assert.ok(
                halo.some((record) => samePoint(record, source)),
                `required halo source ${source.x}/${source.y}/${source.z} survives cap pressure`,
              );
          } else {
            assert.equal(
              firstRecords.length,
              expectedHalo.length + 1,
              "uncapped membership includes own source and every halo source",
            );
            assert.deepEqual(
              firstRecords,
              [...firstRecords].sort(compareRecords),
              "uncapped records retain production order",
            );
            assert.deepEqual(
              halo.map(({ x, y, z }) => `${x}/${y}/${z}`),
              expectedHalo.map(({ x, y, z }) => `${x}/${y}/${z}`),
              "uncapped halo membership matches fixture",
            );
          }
          for (const receiver of fixture.receivers)
            assert.ok(
              hasLightAt(halo, receiver),
              `receiver ${receiver.x}/${receiver.y}/${receiver.z} remains within source radius`,
            );
        },
      );
    });
  }
}
