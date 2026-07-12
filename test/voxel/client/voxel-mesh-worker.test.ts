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
import { buildWithProductionWorker } from "../support/worker-harness.js";

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
