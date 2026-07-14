import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  brotliCompressSync,
  brotliDecompressSync,
  gunzipSync,
  gzipSync,
} from "node:zlib";

import {
  readBinaryHeader,
  readBinaryQuadMetrics,
} from "../../../src/server/services/greedy-mesh.js";
import {
  colors,
  shapes,
  stonePlane,
  withTemporarySave,
  writeRegions,
  writeSurface,
} from "../support/fixture-world.js";
import { createMixedPayload } from "../support/mixed-payload.js";
import { cleanupVoxelCache, generateLod1 } from "../support/production.js";

after(cleanupVoxelCache);

test("server directly encodes representative mixed payload sections", () => {
  const payload = createMixedPayload();
  const header = readBinaryHeader(new DataView(payload), payload.byteLength);
  const metrics = readBinaryQuadMetrics(payload);

  assert.equal(header.quadCount, 2);
  assert.equal(header.greedyRecordCount, 1);
  assert.equal(header.modelRecordCount, 1);
  assert.equal(header.emitterRecordCount, 1);
  assert.equal(header.emitterMetadataCount, 1);
  assert.equal(metrics.transparentQuads, 1);
  assert.equal(metrics.emitterPowerMax, 2.5);
  assert.equal(metrics.emitterRadiusMax, 9);
});

test("server compression variants preserve mixed payload bytes", () => {
  const payload = Buffer.from(createMixedPayload());
  assert.deepEqual(gunzipSync(gzipSync(payload)), payload);
  assert.deepEqual(brotliDecompressSync(brotliCompressSync(payload)), payload);
});

test("persistent cache round trip preserves generated payload bytes", async () => {
  await withTemporarySave("persistent-round-trip", async (save) => {
    await writeSurface(save);
    await writeRegions(save, stonePlane());

    const generated = await generateLod1(save, colors, shapes);
    const cached = await generateLod1(save, colors, shapes);

    assert.equal(cached.stats.cacheTier, "disk");
    assert.deepEqual(Buffer.from(cached.buffer), Buffer.from(generated.buffer));
  });
});
