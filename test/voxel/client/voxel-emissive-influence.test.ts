import assert from "node:assert/strict";
import { after, test } from "node:test";

import {
  colors,
  EMITTER,
  shapes,
  stonePlane,
  withTemporarySave,
  writeRegions,
  writeSurface,
} from "../support/fixture-world.js";
import { getEmitterRecordOffset } from "../support/payload-records.js";
import { cleanupVoxelCache, generateLod1 } from "../support/production.js";
import { buildWithProductionWorker } from "../support/worker-harness.js";

after(cleanupVoxelCache);

test("client worker applies in-radius, out-of-radius, and open-face emitter influence", async () => {
  await withTemporarySave("worker-influence", async (save) => {
    await writeSurface(save);
    await writeRegions(save, [
      ...stonePlane(),
      { x: 64, y: 64, z: 1, type: EMITTER },
    ]);
    const generated = await generateLod1(save, colors, shapes);
    assert.ok(generated.buffer);
    const withinRadius = await buildWithProductionWorker(
      generated.buffer.slice(0),
    );
    const distant = generated.buffer.slice(0);
    const restricted = generated.buffer.slice(0);
    const offset = getEmitterRecordOffset(distant);
    new DataView(distant).setInt32(offset, 10_000, true);
    // Zero is the legacy "all faces open" encoding, so retain only +X here.
    new DataView(restricted).setUint8(offset + 15, 0b10);
    const [outsideRadius, closedFaces] = await Promise.all([
      buildWithProductionWorker(distant),
      buildWithProductionWorker(restricted),
    ]);
    const inRadiusEnergy = emissiveEnergy(withinRadius);
    assert.ok(inRadiusEnergy > 0, "nearby generated emitter affects mesh");
    assert.equal(
      emissiveEnergy(outsideRadius),
      0,
      "out-of-radius emitter does not affect mesh",
    );
    assert.ok(
      emissiveEnergy(closedFaces) < inRadiusEnergy,
      "closed emitter faces restrict directional transmission",
    );
  });
});

function emissiveEnergy(
  mesh: Awaited<ReturnType<typeof buildWithProductionWorker>>,
): number {
  let total = 0;
  for (const quadrant of mesh.quadrantMeshes) {
    for (const value of quadrant.emissiveColors ?? []) total += value;
  }
  return total;
}
