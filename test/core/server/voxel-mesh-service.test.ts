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
  cacheByteLimit = 256 * 1024 * 1024,
): VoxelMeshService {
  return new VoxelMeshService(
    "/unused",
    colors,
    shapes,
    1,
    16,
    undefined,
    {
      pool,
      emitterSummaries: summaries,
      computeSourceSignature,
    },
    cacheByteLimit,
  );
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

test("accounts shared raw storage once and evicts when a compression variant grows the entry", async () => {
  const pool = new DeferredVoxelPool();
  const service = createService(
    pool,
    new RecordingEmitterSummaries(),
    async () => "source",
    140,
  );
  const pending = service.getVoxelMesh("1/0/0", 1, 0, 0, "identity");
  const job = pool.jobs[0];
  assert.ok(job);
  if (job) pool.complete(job, Buffer.allocUnsafeSlow(128).fill(1));
  await pending;
  assert.deepEqual(
    {
      entries: service.getMetricsSnapshot().cacheEntries,
      bytes: service.getMetricsSnapshot().cacheBytes,
      rawBytes: service.getMetricsSnapshot().cacheRawBytes,
    },
    { entries: 1, bytes: 128, rawBytes: 128 },
  );

  await service.getVoxelMesh("1/0/0", 1, 0, 0, "gzip");
  const metrics = service.getMetricsSnapshot();
  assert.equal(metrics.cacheEntries, 0);
  assert.equal(metrics.cacheBytes, 0);
  assert.equal(metrics.cacheOversizedSkips, 1);
});

test("serves but does not retain an individually oversized raw mesh", async () => {
  const pool = new DeferredVoxelPool();
  const service = createService(
    pool,
    new RecordingEmitterSummaries(),
    async () => "source",
    2,
  );
  const pending = service.getVoxelMesh("1/0/0", 1, 0, 0, "identity");
  const job = pool.jobs[0];
  assert.ok(job);
  if (job) pool.complete(job, Buffer.allocUnsafeSlow(3));
  assert.equal((await pending).status, "ok");
  assert.equal(service.getMetricsSnapshot().cacheEntries, 0);
  assert.equal(service.getMetricsSnapshot().cacheOversizedSkips, 1);
});

test("does not retain request preparation after a failed mesh request", async () => {
  const pool = new DeferredVoxelPool();
  const service = createService(pool);
  assert.match(
    (await service.getCurrentEtag("1/0/0", 1, 0, 0, "identity")) ?? "",
    /source/,
  );
  const pending = service.getVoxelMesh("1/0/0", 1, 0, 0, "identity");
  const job = pool.jobs[0];
  assert.ok(job);
  if (job) pool.fail(job);
  await assert.rejects(pending, /generation failed/);
  assert.equal(service.getMetricsSnapshot().cacheEntries, 0);
});

test("exposes summary cache diagnostics and clears summary state globally", () => {
  const summaries = new RecordingEmitterSummaries();
  summaries.metrics = {
    entries: 3,
    estimatedBytes: 4096,
    retainedClusters: 24,
    evictions: 2,
    oversizedSkips: 1,
    activeWork: 4,
  };
  const service = createService(new DeferredVoxelPool(), summaries);

  const metrics = service.getMetricsSnapshot();
  assert.deepEqual(
    {
      entries: metrics.summaryCacheEntries,
      estimatedBytes: metrics.summaryCacheEstimatedBytes,
      retainedClusters: metrics.summaryCacheRetainedClusters,
      evictions: metrics.summaryCacheEvictions,
      oversizedSkips: metrics.summaryCacheOversizedSkips,
      activeWork: metrics.summaryActiveWork,
    },
    summaries.metrics,
  );

  service.clearAll();
  assert.equal(summaries.clearCount, 1);
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
