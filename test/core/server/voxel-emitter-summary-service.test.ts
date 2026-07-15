import assert from "node:assert/strict";
import { test } from "node:test";
import type { EmitterSummaryCluster } from "../../../src/server/services/voxel-emitter-aggregation.js";
import { VoxelEmitterSummaryService } from "../../../src/server/services/voxel-emitter-summary-service.js";
import { colors, shapes } from "../../voxel/support/fixture-world.js";
import { createDeferred } from "../support/deferred.js";

interface LeafBuildResult {
  clusters: EmitterSummaryCluster[];
  rawSourceCount: number;
  cappedClusterCount: number;
  leafParses: number;
}

let nextServiceId = 0;

class ControlledSummaryService extends VoxelEmitterSummaryService {
  readonly started: string[] = [];
  activeBuilds = 0;
  maxActiveBuilds = 0;
  private readonly builds = new Map<
    string,
    ReturnType<typeof createDeferred<LeafBuildResult>>
  >();
  private readonly sourceSignaturePrefix = `controlled-${nextServiceId++}`;

  constructor(
    leafBuildLimit: number,
    memoryCacheSize = 16,
    memoryCacheByteLimit = 1024 * 1024,
  ) {
    super("/unused", colors, shapes, memoryCacheSize, {
      leafBuildLimit,
      memoryCacheByteLimit,
    });
  }

  protected override buildLeafSourceSignature(
    regionX: number,
    regionY: number,
  ): Promise<string> {
    return Promise.resolve(
      `${this.sourceSignaturePrefix}/${regionX}/${regionY}`,
    );
  }

  protected override buildLeaf(
    regionX: number,
    regionY: number,
  ): Promise<LeafBuildResult> {
    const key = `${regionX}/${regionY}`;
    const build = createDeferred<LeafBuildResult>();
    this.started.push(key);
    this.activeBuilds++;
    this.maxActiveBuilds = Math.max(this.maxActiveBuilds, this.activeBuilds);
    this.builds.set(key, build);
    return build.promise.finally(() => {
      this.activeBuilds--;
    });
  }

  protected override persistNode(): Promise<void> {
    return Promise.resolve();
  }

  complete(
    regionX: number,
    regionY = 0,
    clusters: EmitterSummaryCluster[] = [],
  ): void {
    this.builds.get(`${regionX}/${regionY}`)?.resolve({
      clusters,
      rawSourceCount: clusters.length,
      cappedClusterCount: 0,
      leafParses: 0,
    });
  }

  fail(regionX: number, regionY = 0): void {
    this.builds.get(`${regionX}/${regionY}`)?.reject(new Error("leaf failed"));
  }
}

function cluster(index: number): EmitterSummaryCluster {
  return {
    powerR: 1,
    powerG: 0.5,
    powerB: 0.25,
    centroidX: index * 8,
    centroidY: index * 4,
    centroidZ: index * 2,
    centroidWeight: 1,
    sourceCount: 1,
    openFaces: 63,
    minX: index * 8,
    minY: index * 4,
    minZ: index * 2,
    maxX: index * 8 + 1,
    maxY: index * 4 + 1,
    maxZ: index * 2 + 1,
    representedLods: 1,
  };
}

async function buildNode(
  service: ControlledSummaryService,
  regionX: number,
  clusters: EmitterSummaryCluster[] = [],
) {
  const pending = service.getNode(1, regionX, 0);
  await waitForStarts(service, service.started.length + 1);
  service.complete(regionX, 0, clusters);
  return pending;
}

async function waitForStarts(
  service: ControlledSummaryService,
  count: number,
): Promise<void> {
  const deadline = performance.now() + 5_000;
  while (performance.now() < deadline) {
    if (service.started.length >= count) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
  }
  assert.fail(
    `Expected ${count} leaf builds to start, got ${service.started.length}`,
  );
}

test("limits distinct cold leaf builds and dispatches queued builds FIFO", async () => {
  const service = new ControlledSummaryService(2);
  const first = service.getNode(1, 0, 0);
  const second = service.getNode(1, 256, 0);
  const third = service.getNode(1, 512, 0);

  await waitForStarts(service, 2);
  assert.deepEqual(service.started, ["0/0", "256/0"]);
  assert.equal(service.maxActiveBuilds, 2);
  assert.equal(service.getMetricsSnapshot().leafBuildActive, 2);
  assert.equal(service.getMetricsSnapshot().leafBuildQueued, 1);

  service.complete(0);
  await waitForStarts(service, 3);
  assert.deepEqual(service.started, ["0/0", "256/0", "512/0"]);
  assert.equal(service.maxActiveBuilds, 2);

  service.complete(256);
  service.complete(512);
  await Promise.all([first, second, third]);
});

test("distinguishes node traversal from cold leaf extraction", async () => {
  const service = new ControlledSummaryService(4);
  const root = service.getNode(2, 0, 0);
  await waitForStarts(service, 4);
  for (const regionX of [0, 128]) {
    for (const regionY of [0, 128]) service.complete(regionX, regionY);
  }
  await root;

  const cold = service.getMetricsSnapshot();
  assert.equal(cold.nodeRequests, 5);
  assert.equal(cold.nodeBuilds, 5);
  assert.equal(cold.leafExtractions, 4);

  await service.getNode(2, 0, 0);
  const warm = service.getMetricsSnapshot();
  assert.equal(warm.nodeRequests, 10);
  assert.equal(warm.nodeMemoryHits, 5);
  assert.equal(warm.leafExtractions, 4);
});

test("deduplicates in-flight requests and bypasses the limiter for cached reads", async () => {
  const service = new ControlledSummaryService(1);
  const first = service.getNode(1, 0, 0);
  const duplicate = service.getNode(1, 0, 0);
  assert.equal(first, duplicate);

  await waitForStarts(service, 1);
  service.complete(0);
  await first;

  await service.getNode(1, 0, 0);
  assert.deepEqual(service.started, ["0/0"]);
});

test("releases leaf build capacity after a rejected build", async () => {
  const service = new ControlledSummaryService(1);
  const failed = service.getNode(1, 0, 0);
  const queued = service.getNode(1, 256, 0);

  await waitForStarts(service, 1);
  service.fail(0);
  await assert.rejects(failed, /leaf failed/);
  await waitForStarts(service, 2);
  assert.deepEqual(service.started, ["0/0", "256/0"]);

  service.complete(256);
  await queued;
});

test("accounts dense nodes by serialized bytes and retained clusters", async () => {
  const service = new ControlledSummaryService(1);
  const result = await buildNode(
    service,
    0,
    Array.from({ length: 12 }, (_, index) => cluster(index)),
  );

  assert.deepEqual(service.getMetricsSnapshot(), {
    entries: 1,
    estimatedBytes: Buffer.byteLength(JSON.stringify(result.node), "utf8"),
    retainedClusters: 12,
    evictions: 0,
    oversizedSkips: 0,
    activeWork: 0,
    nodeRequests: 1,
    nodeMemoryHits: 0,
    nodeDiskHits: 0,
    nodeBuilds: 1,
    leafExtractions: 1,
    extractedSources: 12,
    leafBuildLimit: 1,
    leafBuildActive: 0,
    leafBuildQueued: 0,
  });
});

test("evicts summary nodes in byte-weighted least-recently-used order", async () => {
  const probe = new ControlledSummaryService(1);
  const firstProbe = await buildNode(probe, 128, [cluster(0)]);
  const secondProbe = await buildNode(probe, 256, [cluster(0)]);
  const byteLimit =
    Buffer.byteLength(JSON.stringify(firstProbe.node), "utf8") +
    Buffer.byteLength(JSON.stringify(secondProbe.node), "utf8");

  const service = new ControlledSummaryService(1, 16, byteLimit);
  await buildNode(service, 128, [cluster(0)]);
  await buildNode(service, 256, [cluster(0)]);
  await service.getNode(1, 128, 0);
  await buildNode(service, 384, [cluster(0)]);

  const startsBeforeHits = service.started.length;
  await service.getNode(1, 128, 0);
  await service.getNode(1, 384, 0);
  assert.equal(service.started.length, startsBeforeHits);

  const rebuilt = service.getNode(1, 256, 0);
  await waitForStarts(service, startsBeforeHits + 1);
  service.complete(256, 0, [cluster(0)]);
  await rebuilt;
  assert.ok(service.getMetricsSnapshot().evictions >= 1);
});

test("serves but does not retain an individually oversized summary node", async () => {
  const service = new ControlledSummaryService(1, 16, 1);
  await buildNode(service, 0, [cluster(0)]);
  assert.deepEqual(service.getMetricsSnapshot(), {
    entries: 0,
    estimatedBytes: 0,
    retainedClusters: 0,
    evictions: 0,
    oversizedSkips: 1,
    activeWork: 0,
    nodeRequests: 1,
    nodeMemoryHits: 0,
    nodeDiskHits: 0,
    nodeBuilds: 1,
    leafExtractions: 1,
    extractedSources: 1,
    leafBuildLimit: 1,
    leafBuildActive: 0,
    leafBuildQueued: 0,
  });

  const second = service.getNode(1, 0, 0);
  await waitForStarts(service, 2);
  service.complete(0, 0, [cluster(0)]);
  await second;
});

test("does not retain stale completion after targeted invalidation", async () => {
  const service = new ControlledSummaryService(1);
  const stale = service.getNode(1, 0, 0);
  await waitForStarts(service, 1);
  assert.equal(service.getMetricsSnapshot().activeWork, 1);
  service.invalidate(1, 0, 0);
  service.complete(0);
  await stale;
  assert.equal(service.getMetricsSnapshot().entries, 0);

  const fresh = service.getNode(1, 0, 0);
  await waitForStarts(service, 2);
  service.complete(0);
  await fresh;
  assert.equal(service.getMetricsSnapshot().entries, 1);
});

test("does not retain stale completion after global invalidation", async () => {
  const service = new ControlledSummaryService(2);
  const first = service.getNode(1, 0, 0);
  const second = service.getNode(1, 128, 0);
  await waitForStarts(service, 2);
  service.clear();
  service.complete(0);
  service.complete(128);
  await Promise.all([first, second]);
  assert.equal(service.getMetricsSnapshot().entries, 0);
  assert.equal(service.getMetricsSnapshot().activeWork, 0);
});
