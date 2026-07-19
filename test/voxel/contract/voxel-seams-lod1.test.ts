import assert from "node:assert/strict";
import { after, test } from "node:test";

import {
  colors,
  REGION_SIZE,
  samePoint,
  shapes,
  withTemporarySave,
  writeAdjacentFixture,
  writeAdjacentYAxisFixture,
} from "../support/fixture-world.js";
import { decodeEmitterRecords } from "../support/payload-records.js";
import { cleanupVoxelCache, generateLod1 } from "../support/production.js";
import {
  collectSeamEmissive,
  collectYSeamEmissive,
  maxSeamDelta,
} from "../support/seam-colors.js";
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
        const [westMesh, eastMesh, cachedWest, cachedEast] = await Promise.all([
          buildWithProductionWorker(west.buffer.slice(0)),
          buildWithProductionWorker(east.buffer.slice(0)),
          buildWithProductionWorker(west.buffer.slice(0), {
            candidateNeighborhoodMode: "cached",
          }),
          buildWithProductionWorker(east.buffer.slice(0), {
            candidateNeighborhoodMode: "cached",
          }),
        ]);
        assert.deepEqual(
          cachedWest.quadrantMeshes.map((quadrant) => quadrant.emissiveColors),
          westMesh.quadrantMeshes.map((quadrant) => quadrant.emissiveColors),
        );
        assert.deepEqual(
          cachedEast.quadrantMeshes.map((quadrant) => quadrant.emissiveColors),
          eastMesh.quadrantMeshes.map((quadrant) => quadrant.emissiveColors),
        );
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

test("contract LOD1 Y seam ignores asymmetric unrelated emitter populations", async () => {
  await withTemporarySave("contract-lod1-y-seam", async (save) => {
    const fixture = await writeAdjacentYAxisFixture(save);
    const south = await generateLod1(save, colors, shapes);
    const north = await generateLod1(save, colors, shapes, 0, REGION_SIZE);
    assert.ok(south.buffer && north.buffer);

    const southRecords = decodeEmitterRecords(south.buffer);
    const northRecords = decodeEmitterRecords(north.buffer).map((record) => ({
      ...record,
      y: record.y + REGION_SIZE,
    }));
    assert.ok(
      southRecords.some(
        (record) => record.halo && samePoint(record, fixture.crossBoundary),
      ),
      "south payload retains the north-owned source as a halo record",
    );
    assert.ok(
      northRecords.some(
        (record) => !record.halo && samePoint(record, fixture.crossBoundary),
      ),
      "north payload retains the cross-boundary source as an own record",
    );
    assert.equal(
      southRecords.filter(
        (record) =>
          !record.halo &&
          fixture.southUnrelated.some((source) => samePoint(record, source)),
      ).length,
      fixture.southUnrelated.length,
      "south payload retains its unrelated own emitters",
    );
    assert.equal(
      northRecords.filter(
        (record) =>
          !record.halo &&
          fixture.northUnrelated.some((source) => samePoint(record, source)),
      ).length,
      fixture.northUnrelated.length,
      "north payload retains a different unrelated own-emitter population",
    );

    const [southMesh, northMesh, cachedSouth, cachedNorth] = await Promise.all([
      buildWithProductionWorker(south.buffer.slice(0)),
      buildWithProductionWorker(north.buffer.slice(0)),
      buildWithProductionWorker(south.buffer.slice(0), {
        candidateNeighborhoodMode: "cached",
      }),
      buildWithProductionWorker(north.buffer.slice(0), {
        candidateNeighborhoodMode: "cached",
      }),
    ]);
    assert.deepEqual(
      cachedSouth.quadrantMeshes.map((quadrant) => quadrant.emissiveColors),
      southMesh.quadrantMeshes.map((quadrant) => quadrant.emissiveColors),
    );
    assert.deepEqual(
      cachedNorth.quadrantMeshes.map((quadrant) => quadrant.emissiveColors),
      northMesh.quadrantMeshes.map((quadrant) => quadrant.emissiveColors),
    );
    const seam = maxSeamDelta(
      collectYSeamEmissive(southMesh, REGION_SIZE),
      collectYSeamEmissive(northMesh, REGION_SIZE),
    );
    assert.ok(
      seam.count > 0,
      "matching Y-seam vertices are identified by world position and normal",
    );
    assert.ok(
      seam.delta <= 1 / 255,
      `normalized Y-seam delta ${seam.delta} is within one compact encoding step`,
    );
  });
});
