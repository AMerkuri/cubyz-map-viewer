import assert from "node:assert/strict";
import { test } from "node:test";
import { VoxelMeshService } from "../../../src/server/services/voxel-mesh-service.js";
import { colors, shapes } from "../../voxel/support/fixture-world.js";
import { coordinateMatrix } from "../support/coordinates.js";
import { createDeferred } from "../support/deferred.js";
import {
  DeferredVoxelPool,
  RecordingEmitterSummaries,
} from "../support/voxel-service-fakes.js";

function createService(
  pool = new DeferredVoxelPool(),
  summaries = new RecordingEmitterSummaries(),
  computeSourceSignature: () => Promise<string | null> = async () => "source",
): VoxelMeshService {
  return new VoxelMeshService("/unused", colors, shapes, 1, 16, undefined, {
    pool,
    emitterSummaries: summaries,
    computeSourceSignature,
  });
}

test("deduplicates same-key jobs, caches results, and separates halo identities", async () => {
  const pool = new DeferredVoxelPool();
  const service = createService(pool);
  const first = service.getVoxelMesh("1/0/0", 1, 0, 0, "identity");
  const second = service.getVoxelMesh("1/0/0", 1, 0, 0, "identity");
  assert.equal(pool.jobs.length, 1);
  const job = pool.jobs[0];
  assert.ok(job);
  pool.complete(job);
  const [firstResponse, secondResponse] = await Promise.all([first, second]);
  assert.equal(firstResponse.status, "ok");
  assert.equal(secondResponse.status, "ok");
  await service.getVoxelMesh("1/0/0", 1, 0, 0, "identity");
  const brotli = await service.getVoxelMesh("1/0/0", 1, 0, 0, "br");
  const gzip = await service.getVoxelMesh("1/0/0", 1, 0, 0, "gzip");
  assert.equal(
    pool.jobs.length,
    1,
    "cached and encoded variants avoid worker jobs",
  );
  assert.match(brotli.etag ?? "", /-br-source"$/);
  assert.match(gzip.etag ?? "", /-gzip-source"$/);
  assert.notEqual(brotli.etag, gzip.etag);

  const noHalo = service.getVoxelMesh(
    "1/0/0#nohalo",
    1,
    0,
    0,
    "identity",
    false,
  );
  assert.equal(pool.jobs.length, 2);
  const noHaloJob = pool.jobs[1];
  assert.equal(noHaloJob?.includeHaloEmitters, false);
  if (noHaloJob) pool.complete(noHaloJob);
  await noHalo;
});

for (const clear of [
  (service: VoxelMeshService) => service.clear("1/0/0"),
  (service: VoxelMeshService) => service.clearAll(),
]) {
  test("does not cache an invalidated pending result", async () => {
    const pool = new DeferredVoxelPool();
    const service = createService(pool);
    const pending = service.getVoxelMesh("1/0/0", 1, 0, 0, "identity");
    const job = pool.jobs[0];
    assert.ok(job);
    clear(service);
    if (job) pool.complete(job);
    assert.equal((await pending).status, "empty");

    const refreshed = service.getVoxelMesh("1/0/0", 1, 0, 0, "identity");
    assert.equal(pool.jobs.length, 2);
    const refreshJob = pool.jobs[1];
    if (refreshJob) pool.complete(refreshJob);
    assert.equal((await refreshed).status, "ok");
  });
}

test("drops a result invalidated while its source signature is being computed", async () => {
  const pool = new DeferredVoxelPool();
  const signature = createDeferred<string | null>();
  const service = createService(
    pool,
    new RecordingEmitterSummaries(),
    () => signature.promise,
  );
  const pending = service.getVoxelMesh("1/0/0", 1, 0, 0, "identity");
  const job = pool.jobs[0];
  assert.ok(job);
  if (job) pool.complete(job);
  await Promise.resolve();
  service.clear("1/0/0");
  signature.resolve("source");
  assert.equal((await pending).status, "empty");
});

test("invalidates every LOD 1 halo leaf and floor-aligned summary ancestor", () => {
  for (const { name, regionX, regionY } of coordinateMatrix) {
    const summaries = new RecordingEmitterSummaries();
    createService(
      new DeferredVoxelPool(),
      summaries,
    ).invalidateLod1EmitterColumn(regionX, regionY);
    const keys = new Set(
      summaries.invalidations.map(
        ({ lod, regionX, regionY }) => `${lod}/${regionX}/${regionY}`,
      ),
    );
    assert.ok(
      keys.has(`1/${regionX - 128}/${regionY - 128}`),
      `${name} includes diagonal leaf`,
    );
    assert.ok(
      keys.has(
        `2/${Math.floor((regionX - 128) / 256) * 256}/${Math.floor((regionY - 128) / 256) * 256}`,
      ),
    );
  }
  const negativeSummaries = new RecordingEmitterSummaries();
  createService(
    new DeferredVoxelPool(),
    negativeSummaries,
  ).invalidateLod1EmitterColumn(-128, 0);
  const negativeKeys = new Set(
    negativeSummaries.invalidations.map(
      ({ lod, regionX, regionY }) => `${lod}/${regionX}/${regionY}`,
    ),
  );
  assert.ok(negativeKeys.has("32/-4096/-4096"), "coarsest ancestor floors");
  assert.ok(
    negativeKeys.has("32/0/0"),
    "positive boundary ancestor is included",
  );
});
