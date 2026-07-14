import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveVoxelWorkerCount } from "../../../src/server/services/voxel-worker-config.js";

test("resolves explicit and hardware-derived voxel worker counts", () => {
  assert.equal(resolveVoxelWorkerCount("4"), 4);
  assert.ok(resolveVoxelWorkerCount(undefined) >= 1);
});

test("rejects malformed, zero, and negative voxel worker counts", () => {
  for (const value of ["", "zero", "1.5", "0", "-1"]) {
    assert.throws(() => resolveVoxelWorkerCount(value), /VOXEL_WORKERS/);
  }
});
