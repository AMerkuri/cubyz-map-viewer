import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  VoxelContentEncoding,
  VoxelMeshResponse,
  VoxelMeshServiceApi,
  VoxelServiceMetricsSnapshot,
} from "../../../src/server/services/voxel-mesh-service.js";
import { VoxelQueueFullError } from "../../../src/server/services/voxel-worker-pool.js";
import { abortVoxelsRequest, requestVoxels } from "../support/http-harness.js";

const metrics: VoxelServiceMetricsSnapshot = {
  workers: 1,
  workerRuntimeMode: "source",
  queueDepth: 0,
  queueLimit: 32,
  admissionAccepted: 0,
  admissionRejected: 0,
  queuedCancellations: 0,
  runningJobs: 0,
  inFlightJobs: 0,
  inFlightConsumers: 0,
  sharedPipelineConsumers: 0,
  consumerCancellations: 0,
  runningOrphans: 0,
  orphanRejoins: 0,
  orphanCompletions: 0,
  mainProcessMemory: {
    rss: 0,
    heapUsed: 0,
    heapTotal: 0,
    external: 0,
    arrayBuffers: 0,
  },
  cacheEntries: 0,
  cacheBytes: 0,
  cacheRawBytes: 0,
  cacheVariantBytes: 0,
  cacheEvictions: 0,
  cacheOversizedSkips: 0,
  summaryCacheEntries: 0,
  summaryCacheEstimatedBytes: 0,
  summaryCacheRetainedClusters: 0,
  summaryCacheEvictions: 0,
  summaryCacheOversizedSkips: 0,
  summaryActiveWork: 0,
  summaryNodeRequests: 0,
  summaryNodeMemoryHits: 0,
  summaryNodeDiskHits: 0,
  summaryNodeBuilds: 0,
  summaryLeafExtractions: 0,
  summaryExtractedSources: 0,
  summaryLeafBuildLimit: 1,
  summaryLeafBuildActive: 0,
  summaryLeafBuildQueued: 0,
  requests: 0,
  cacheHits: 0,
  workerRequests: 0,
  emptyResponses: 0,
  staleDrops: 0,
  errors: 0,
  queueMsAvg: 0,
  queueMsMax: 0,
  runMsAvg: 0,
  runMsMax: 0,
  totalMsAvg: 0,
  totalMsMax: 0,
};

function response(encoding: VoxelContentEncoding): VoxelMeshResponse {
  return {
    status: "ok",
    buf: Buffer.from([1, 2, 3]),
    etag: `"etag-${encoding}"`,
    contentEncoding: encoding === "identity" ? undefined : encoding,
    metrics: {
      source: "worker",
      cacheOutcome: "miss",
      queueMs: 0,
      runMs: 0,
      totalMs: 0,
      queueDepth: 0,
      runningJobs: 0,
      inFlightJobs: 0,
      byteLength: 3,
    },
  };
}

class FakeVoxelService implements VoxelMeshServiceApi {
  readonly calls: Array<{
    key: string;
    encoding: VoxelContentEncoding;
    includeHaloEmitters: boolean;
  }> = [];
  etag: string | null = '"etag-br"';
  empty = false;

  async getCurrentEtag(
    _key: string,
    _lod: number,
    _regionX: number,
    _regionY: number,
    encoding: VoxelContentEncoding,
  ): Promise<string | null> {
    return this.etag === null ? null : this.etag.replace("br", encoding);
  }

  async getVoxelMesh(
    key: string,
    _lod: number,
    _regionX: number,
    _regionY: number,
    encoding: VoxelContentEncoding,
    includeHaloEmitters = true,
    _signal?: AbortSignal,
  ): Promise<VoxelMeshResponse> {
    this.calls.push({ key, encoding, includeHaloEmitters });
    return this.empty
      ? {
          ...response(encoding),
          status: "empty",
          buf: undefined,
          etag: undefined,
        }
      : response(encoding);
  }

  getMetricsSnapshot(): VoxelServiceMetricsSnapshot {
    return metrics;
  }

  async benchmarkVoxelMesh(): Promise<null> {
    return null;
  }
}

for (const [header, expected] of [
  ["br", "br"],
  ["gzip", "gzip"],
  ["*", "br"],
  ["gzip;q=1, br;q=0.5", "gzip"],
  ["gzip, br", "br"],
  ["br;q=0, gzip", "gzip"],
] as const) {
  test(`negotiates ${header}`, async () => {
    const service = new FakeVoxelService();
    const result = await requestVoxels(service, "/api/voxels/1/0/0", {
      "accept-encoding": header,
    });
    assert.equal(result.status, 200);
    assert.equal(service.calls[0]?.encoding, expected);
  });
}

test("rejects unsupported encodings before requesting the service", async () => {
  const service = new FakeVoxelService();
  const result = await requestVoxels(service, "/api/voxels/1/0/0", {
    "accept-encoding": "identity, br;q=0, gzip;q=0",
  });
  assert.equal(result.status, 406);
  assert.equal(service.calls.length, 0);
});

test("returns cache headers, conditional responses, empty responses, and diagnostic keys", async () => {
  const service = new FakeVoxelService();
  const success = await requestVoxels(service, "/api/voxels/1/0/0?halo=0", {
    "accept-encoding": "br",
  });
  assert.equal(success.status, 200);
  assert.equal(success.headers.etag, '"etag-br"');
  assert.equal(success.headers.vary, "Accept-Encoding");
  assert.equal(success.headers["content-encoding"], "br");
  assert.equal(
    success.headers["cache-control"],
    "public, max-age=0, must-revalidate",
  );
  assert.deepEqual(service.calls[0], {
    key: "1/0/0#nohalo",
    encoding: "br",
    includeHaloEmitters: false,
  });

  const conditional = await requestVoxels(service, "/api/voxels/1/0/0", {
    "accept-encoding": "br",
    "if-none-match": '"etag-br"',
  });
  assert.equal(conditional.status, 304);
  assert.equal(conditional.headers.vary, "Accept-Encoding");

  service.etag = null;
  const missing = await requestVoxels(service, "/api/voxels/1/0/0", {
    "accept-encoding": "br",
  });
  assert.equal(missing.status, 204);
  assert.equal(missing.headers["cache-control"], "no-store");

  service.etag = '"etag-br"';
  service.empty = true;
  const empty = await requestVoxels(service, "/api/voxels/1/0/0", {
    "accept-encoding": "br",
  });
  assert.equal(empty.status, 204);
  assert.equal(empty.headers["cache-control"], "no-store");
});

test("returns retry guidance when distinct queue admission is full", async () => {
  const service = new FakeVoxelService();
  service.getVoxelMesh = async () => {
    throw new VoxelQueueFullError();
  };
  const result = await requestVoxels(service, "/api/voxels/1/0/0", {
    "accept-encoding": "br",
  });
  assert.equal(result.status, 503);
  assert.equal(result.headers["retry-after"], "1");
});

test("aborts the service consumer when the HTTP client disconnects", async () => {
  const service = new FakeVoxelService();
  let receivedSignal: AbortSignal | undefined;
  service.getVoxelMesh = async (
    _key: string,
    _lod: number,
    _regionX: number,
    _regionY: number,
    _encoding: VoxelContentEncoding,
    _includeHalo = true,
    signal?: AbortSignal,
  ) => {
    receivedSignal = signal;
    await new Promise<void>((resolve) =>
      signal?.addEventListener("abort", () => resolve(), { once: true }),
    );
    const error = new Error("aborted");
    error.name = "AbortError";
    throw error;
  };
  await abortVoxelsRequest(service, "/api/voxels/1/0/0");
  assert.equal(receivedSignal?.aborted, true);
});

for (const path of [
  "/api/voxels/3/0/0",
  "/api/voxels/1/NaN/0",
  "/api/voxels/1/1/0",
  "/api/voxels/metrics?lod=3&regionX=0&regionY=0",
  "/api/voxels/metrics?lod=&regionX=0&regionY=0",
  "/api/voxels/metrics?lod=1&regionX=0",
]) {
  test(`rejects invalid coordinates for ${path}`, async () => {
    const result = await requestVoxels(new FakeVoxelService(), path, {
      "accept-encoding": "br",
    });
    assert.equal(result.status, 400);
  });
}
