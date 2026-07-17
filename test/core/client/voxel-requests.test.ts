import assert from "node:assert/strict";
import { test } from "node:test";

import type { PendingVoxelFetchRequest } from "../../../src/client/features/world-view/lib/types.js";
import {
  fetchVoxelRegion,
  scheduleVoxelCapacityRetry,
} from "../../../src/client/features/world-view/lib/voxel-requests.js";

const request: PendingVoxelFetchRequest = {
  key: "1/0/0",
  lod: 1,
  regionX: 0,
  regionY: 0,
  priority: {
    coverageClass: "detail",
    safetyClass: "optional",
    viewClass: "forward",
    phase: "base",
    projectedBenefit: 1,
    distance: 1,
    lod: 1,
    generation: 1,
    demandSince: 0,
    sequence: 1,
  },
  generation: 1,
  version: 0,
  selectedAt: 0,
};

function fetchArgs(failedVoxelsRef: { current: Map<string, number> }) {
  return {
    request,
    controller: new AbortController(),
    activeVoxelRequestKeysRef: { current: new Set([request.key]) },
    loadedVoxelsRef: { current: new Map() },
    loadingVoxelsRef: { current: new Set([request.key]) },
    missingVoxelsRef: { current: new Set<string>() },
    failedVoxelsRef,
    isVoxelTileStale: () => false,
    onFinally: () => undefined,
    onCompactInput: () => undefined,
  };
}

test("capacity responses release the fetch without consuming failure budget", async () => {
  const originalFetch = globalThis.fetch;
  const failures = { current: new Map<string, number>() };
  let retryAfterMs = -1;
  let finishes = 0;
  try {
    globalThis.fetch = async () =>
      new Response(null, {
        status: 503,
        headers: { "Retry-After": "0.01" },
      });
    const args = fetchArgs(failures);
    await fetchVoxelRegion({
      ...args,
      onFinally: () => {
        finishes++;
      },
      onCapacityRetry: (_request, delay) => {
        retryAfterMs = delay;
      },
    });
    assert.equal(retryAfterMs, 10);
    assert.equal(failures.current.size, 0);
    assert.equal(args.loadingVoxelsRef.current.size, 0);
    assert.equal(finishes, 1, "capacity is released for other fetch work");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("non-capacity errors retain permanent failure accounting", async () => {
  const originalFetch = globalThis.fetch;
  const failures = { current: new Map<string, number>() };
  try {
    globalThis.fetch = async () => new Response(null, { status: 500 });
    await fetchVoxelRegion(fetchArgs(failures));
    assert.equal(failures.current.get(request.key), 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("delayed capacity retry only requeues demand that remains active", async () => {
  const retryNotBeforeRef = { current: new Map<string, number>() };
  const activeVoxelRequestKeysRef = { current: new Set([request.key]) };
  const retries: string[] = [];
  const args = {
    request,
    retryAfterMs: 5,
    retryNotBeforeRef,
    activeVoxelRequestKeysRef,
    loadedVoxelsRef: { current: new Map() },
    isVoxelTileStale: () => false,
    requestVoxelRegion: (item: PendingVoxelFetchRequest) =>
      retries.push(item.key),
  };
  scheduleVoxelCapacityRetry(args);
  assert.ok(retryNotBeforeRef.current.has(request.key));
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.deepEqual(retries, [request.key]);

  scheduleVoxelCapacityRetry(args);
  activeVoxelRequestKeysRef.current.clear();
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.deepEqual(retries, [request.key]);
});
