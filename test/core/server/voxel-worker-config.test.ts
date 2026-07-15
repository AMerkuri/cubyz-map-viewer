import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_VOXEL_QUEUE_LIMIT,
  DEFAULT_VOXEL_WORKERS,
  resolveVoxelQueueLimit,
  resolveVoxelWorkerCount,
} from "../../../src/server/services/voxel-worker-config.js";

test("resolves explicit and conservative default voxel worker counts", () => {
  assert.equal(resolveVoxelWorkerCount("4"), 4);
  assert.equal(resolveVoxelWorkerCount(undefined), DEFAULT_VOXEL_WORKERS);
  assert.equal(resolveVoxelWorkerCount(undefined), 1);
});

test("resolves the voxel queue limit with a finite default", () => {
  assert.equal(DEFAULT_VOXEL_QUEUE_LIMIT, 8);
  assert.equal(resolveVoxelQueueLimit(undefined), DEFAULT_VOXEL_QUEUE_LIMIT);
  assert.equal(resolveVoxelQueueLimit("7"), 7);
  for (const value of ["", "many", "1.5", "0", "-1"]) {
    assert.throws(() => resolveVoxelQueueLimit(value), /VOXEL_QUEUE_LIMIT/);
  }
});

test("rejects malformed, zero, and negative voxel worker counts", () => {
  for (const value of ["", "zero", "1.5", "0", "-1"]) {
    assert.throws(() => resolveVoxelWorkerCount(value), /VOXEL_WORKERS/);
  }
});
