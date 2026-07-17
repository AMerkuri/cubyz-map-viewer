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
import { cleanupVoxelCache, generateLod1 } from "../support/production.js";
import {
  buildProgressiveWithProductionWorker,
  buildWithProductionWorker,
} from "../support/worker-harness.js";

after(cleanupVoxelCache);

test("client worker deterministically decodes generated payloads and bakes emissive attributes", async () => {
  await withTemporarySave("worker-determinism", async (save) => {
    await writeSurface(save);
    await writeRegions(save, [
      ...stonePlane(),
      { x: 64, y: 64, z: 1, type: EMITTER },
    ]);
    const generated = await generateLod1(save, colors, shapes);
    assert.ok(generated.buffer);
    const first = await buildWithProductionWorker(generated.buffer.slice(0));
    const second = await buildWithProductionWorker(generated.buffer.slice(0));
    assert.deepEqual(first.emitterRecords, second.emitterRecords);
    assert.deepEqual(
      first.quadrantMeshes.map(meshSnapshot),
      second.quadrantMeshes.map(meshSnapshot),
    );
    assert.ok(
      first.quadrantMeshes.some((mesh) =>
        mesh.emissiveColors?.some((value) => value > 0),
      ),
      "emitter produces emissive mesh values",
    );
  });
});

test("progressive worker returns base first and preserves one-phase emissive ordering", async () => {
  await withTemporarySave("worker-progressive", async (save) => {
    await writeSurface(save);
    await writeRegions(save, [
      ...stonePlane(),
      { x: 64, y: 64, z: 1, type: EMITTER },
    ]);
    const generated = await generateLod1(save, colors, shapes);
    assert.ok(generated.buffer);
    const compact = generated.buffer.slice(0);
    const progressive = await buildProgressiveWithProductionWorker(compact);
    const onePhase = await buildWithProductionWorker(generated.buffer.slice(0));

    assert.equal(
      progressive.retained,
      compact,
      "compact ownership is not cloned",
    );
    assert.ok(
      progressive.base.quadrantMeshes.every(
        (quadrant) => quadrant.emissiveColors === null,
      ),
    );
    assert.deepEqual(
      progressive.enhancement?.quadrantEnhancements.map((quadrant) => ({
        quadrantIndex: quadrant.quadrantIndex,
        emissiveColors: [...quadrant.emissiveColors],
      })),
      onePhase.quadrantMeshes.flatMap((quadrant) =>
        quadrant.emissiveColors
          ? [
              {
                quadrantIndex: quadrant.quadrantIndex,
                emissiveColors: [...quadrant.emissiveColors],
              },
            ]
          : [],
      ),
    );
    assert.ok(
      progressive.enhancement?.quadrantEnhancements.every(
        (quadrant) =>
          quadrant.emissiveColors instanceof Uint8Array ||
          quadrant.emissiveColors instanceof Uint16Array,
      ),
    );
  });
});

test("progressive worker skips enhancement for payloads without emitters", async () => {
  await withTemporarySave("worker-progressive-unlit", async (save) => {
    await writeSurface(save);
    await writeRegions(save, stonePlane());
    const generated = await generateLod1(save, colors, shapes);
    assert.ok(generated.buffer);
    const progressive = await buildProgressiveWithProductionWorker(
      generated.buffer.slice(0),
    );
    assert.equal(progressive.retained, null);
    assert.equal(progressive.enhancement, null);
  });
});

test("progressive worker treats an empty mesh as base-complete", async () => {
  const emptyPayload = new ArrayBuffer(20);
  new DataView(emptyPayload).setUint32(16, 1, true);
  const progressive = await buildProgressiveWithProductionWorker(emptyPayload);
  assert.equal(progressive.base.quadrantMeshes.length, 4);
  assert.ok(
    progressive.base.quadrantMeshes.every(
      (quadrant) => quadrant.indices.length === 0,
    ),
  );
  assert.equal(progressive.retained, null);
  assert.equal(progressive.enhancement, null);
});

function meshSnapshot(
  mesh: Awaited<
    ReturnType<typeof buildWithProductionWorker>
  >["quadrantMeshes"][number],
): object {
  return {
    positions: [...mesh.positions],
    normals: [...mesh.normals],
    emissiveColors: mesh.emissiveColors ? [...mesh.emissiveColors] : null,
  };
}
