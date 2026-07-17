import assert from "node:assert/strict";
import { test } from "node:test";

import {
  COARSE_EMITTER_INFLUENCE_RADIUS_WORLD,
  deduplicateVoxelInvalidationSources,
  expandVoxelInvalidationBatch,
  expandVoxelInvalidationFootprint,
  LOD1_EMITTER_INFLUENCE_RADIUS_WORLD,
  SUPPORTED_VOXEL_LODS,
  voxelInvalidationRegionKey,
} from "../../../src/server/services/voxel-invalidation.js";

test("voxel invalidation radii match LOD 1 and coarse emitter influence", () => {
  assert.equal(LOD1_EMITTER_INFLUENCE_RADIUS_WORLD, 12);
  assert.equal(COARSE_EMITTER_INFLUENCE_RADIUS_WORLD, 28);
});

test("every supported LOD includes its complete coarse or leaf halo", () => {
  for (const lod of SUPPORTED_VOXEL_LODS) {
    const span = 128 * lod;
    const footprint = expandVoxelInvalidationFootprint({
      lod,
      regionX: 0,
      regionY: 0,
    });
    const sameLodKeys = new Set(
      footprint
        .filter((region) => region.lod === lod)
        .map(voxelInvalidationRegionKey),
    );

    assert.equal(sameLodKeys.size, 9, `LOD ${lod} halo size`);
    assert.ok(sameLodKeys.has(`${lod}/${-span}/0`));
    assert.ok(sameLodKeys.has(`${lod}/${span}/${span}`));
  }
});

test("LOD 1 invalidation includes aligned ancestors at every coarse LOD", () => {
  const footprint = expandVoxelInvalidationFootprint({
    lod: 1,
    regionX: -128,
    regionY: 0,
  });
  const keys = new Set(footprint.map(voxelInvalidationRegionKey));

  for (const lod of SUPPORTED_VOXEL_LODS.slice(1)) {
    const span = 128 * lod;
    assert.ok(keys.has(`${lod}/${-span}/${-span}`), `negative LOD ${lod}`);
    assert.ok(keys.has(`${lod}/0/0`), `positive LOD ${lod}`);
  }
});

test("batch expansion floor-aligns negatives and deduplicates sources and affected keys", () => {
  const unalignedKeys = expandVoxelInvalidationFootprint({
    lod: 2,
    regionX: -1,
    regionY: -1,
  }).map(voxelInvalidationRegionKey);
  assert.ok(unalignedKeys.includes("2/-512/-512"));
  assert.ok(unalignedKeys.includes("2/0/0"));

  const sources = deduplicateVoxelInvalidationSources([
    { lod: 2, regionX: -1, regionY: -1 },
    { lod: 2, regionX: -1, regionY: -1 },
    { lod: 2, regionX: -256, regionY: -256 },
  ]);
  assert.deepEqual(sources, [{ lod: 2, regionX: -256, regionY: -256 }]);

  const affected = expandVoxelInvalidationBatch([
    ...sources,
    { lod: 2, regionX: 0, regionY: -256 },
  ]);
  const keys = affected.map(voxelInvalidationRegionKey);
  assert.equal(keys.length, new Set(keys).size);
  assert.ok(keys.includes("2/-512/-256"));
  assert.ok(keys.includes("2/256/-256"));
});
