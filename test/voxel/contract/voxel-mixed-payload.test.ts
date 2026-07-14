import assert from "node:assert/strict";
import { test } from "node:test";

import { createMixedPayload } from "../support/mixed-payload.js";
import { buildWithProductionWorker } from "../support/worker-harness.js";

test("contract mixed payload remains deterministic across server encode and client decode", async () => {
  const firstPayload = createMixedPayload();
  const secondPayload = createMixedPayload();
  assert.deepEqual(Buffer.from(firstPayload), Buffer.from(secondPayload));

  const first = await buildWithProductionWorker(firstPayload);
  const second = await buildWithProductionWorker(secondPayload);
  assert.deepEqual(first.emitterRecords, second.emitterRecords);
  assert.deepEqual(first.quadrantMeshes, second.quadrantMeshes);
});
