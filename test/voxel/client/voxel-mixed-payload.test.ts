import assert from "node:assert/strict";
import { test } from "node:test";

import { createMixedPayload } from "../support/mixed-payload.js";
import { buildWithProductionWorker } from "../support/worker-harness.js";

test("client decodes mixed greedy/model palette and emitter sections", async () => {
  const mesh = await buildWithProductionWorker(createMixedPayload());

  assert.equal(mesh.emitterRecords.length, 1);
  assert.equal(mesh.emitterRecords[0]?.power, 2.5);
  assert.equal(mesh.emitterRecords[0]?.radius, 9);
  assert.ok(
    mesh.quadrantMeshes.some((quadrant) => quadrant.positions.length > 0),
  );
});
