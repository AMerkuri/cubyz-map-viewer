import type {
  LoadedVoxelTile,
  PendingVoxelCompactInput,
  PendingVoxelFetchRequest,
  PendingVoxelMeshItem,
  VoxelBenchmarkCacheOutcome,
  VoxelRefreshState,
} from "./types.js";
import { compareVoxelWorkPriority } from "./voxel-work.js";

export function compareVoxelFetchRequests(
  a: PendingVoxelFetchRequest,
  b: PendingVoxelFetchRequest,
): number {
  return compareVoxelWorkPriority(a.priority, b.priority, performance.now());
}

export function getVoxelRefreshVersion(
  states: Map<string, VoxelRefreshState>,
  key: string,
): number {
  return states.get(key)?.version ?? 0;
}

export function markVoxelTileStale(
  states: Map<string, VoxelRefreshState>,
  key: string,
): number {
  const nextVersion = getVoxelRefreshVersion(states, key) + 1;
  states.set(key, { version: nextVersion, stale: true });
  return nextVersion;
}

export function markVoxelTileFresh(
  states: Map<string, VoxelRefreshState>,
  key: string,
  version: number,
): void {
  const current = states.get(key);
  if (!current || version >= current.version) {
    states.set(key, { version, stale: false });
  }
}

export function isVoxelTileStale(
  states: Map<string, VoxelRefreshState>,
  key: string,
): boolean {
  return states.get(key)?.stale === true;
}

export function queueVoxelFetchRequest(
  queue: PendingVoxelFetchRequest[],
  request: PendingVoxelFetchRequest,
): void {
  const existingIndex = queue.findIndex((item) => item.key === request.key);
  if (existingIndex !== -1) {
    queue[existingIndex] = request;
  } else {
    queue.push(request);
  }
  queue.sort(compareVoxelFetchRequests);
}

export function syncVoxelRequests(args: {
  requests: Map<string, PendingVoxelFetchRequest>;
  activeVoxelRequestKeysRef: { current: Set<string> };
  pendingVoxelFetchQueueRef: { current: PendingVoxelFetchRequest[] };
  pendingVoxelMeshQueueRef: { current: PendingVoxelMeshItem[] };
  loadedVoxelsRef: { current: Map<string, LoadedVoxelTile> };
  loadingVoxelsRef: { current: Set<string> };
  voxelFetchControllersRef: { current: Map<string, AbortController> };
  isVoxelTileStale: (key: string) => boolean;
  getVoxelRefreshVersion: (key: string) => number;
  requestVoxelRegion: (request: PendingVoxelFetchRequest) => void;
  drainVoxelFetchQueue: () => void;
}): void {
  const {
    requests,
    activeVoxelRequestKeysRef,
    pendingVoxelFetchQueueRef,
    pendingVoxelMeshQueueRef,
    loadedVoxelsRef,
    loadingVoxelsRef,
    voxelFetchControllersRef,
    isVoxelTileStale,
    getVoxelRefreshVersion,
    requestVoxelRegion,
    drainVoxelFetchQueue,
  } = args;

  activeVoxelRequestKeysRef.current = new Set(requests.keys());

  pendingVoxelFetchQueueRef.current = pendingVoxelFetchQueueRef.current.filter(
    (item) => {
      const updated = requests.get(item.key);
      if (
        !updated ||
        (loadedVoxelsRef.current.has(item.key) && !isVoxelTileStale(item.key))
      ) {
        loadingVoxelsRef.current.delete(item.key);
        return false;
      }
      item.priority = updated.priority;
      item.generation = updated.generation;
      item.version = updated.version;
      return true;
    },
  );
  pendingVoxelFetchQueueRef.current.sort(compareVoxelFetchRequests);

  pendingVoxelMeshQueueRef.current = pendingVoxelMeshQueueRef.current.filter(
    (item) => {
      if (item.version < getVoxelRefreshVersion(item.key)) {
        return false;
      }
      if (
        activeVoxelRequestKeysRef.current.has(item.key) ||
        loadedVoxelsRef.current.has(item.key)
      ) {
        return true;
      }
      loadingVoxelsRef.current.delete(item.key);
      return false;
    },
  );

  for (const [key, controller] of voxelFetchControllersRef.current) {
    if (!activeVoxelRequestKeysRef.current.has(key)) {
      controller.abort();
    }
  }

  for (const request of requests.values()) {
    requestVoxelRegion(request);
  }

  drainVoxelFetchQueue();
}

export function finishVoxelFetch(
  key: string,
  voxelFetchControllersRef: { current: Map<string, AbortController> },
  activeVoxelFetchCountRef: { current: number },
  drainVoxelFetchQueue: () => void,
): void {
  voxelFetchControllersRef.current.delete(key);
  activeVoxelFetchCountRef.current = Math.max(
    0,
    activeVoxelFetchCountRef.current - 1,
  );
  drainVoxelFetchQueue();
}

function readNullableHeaderMs(res: Response, header: string): number | null {
  const raw = res.headers.get(header);
  if (raw === null) return null;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : null;
}

function readCacheOutcome(res: Response): VoxelBenchmarkCacheOutcome {
  const raw = res.headers.get("x-voxel-cache");
  return raw === "hit" || raw === "miss" ? raw : "unknown";
}

export async function fetchVoxelRegion(args: {
  request: PendingVoxelFetchRequest;
  controller: AbortController;
  activeVoxelRequestKeysRef: { current: Set<string> };
  loadedVoxelsRef: { current: Map<string, LoadedVoxelTile> };
  loadingVoxelsRef: { current: Set<string> };
  missingVoxelsRef: { current: Set<string> };
  failedVoxelsRef: { current: Map<string, number> };
  isVoxelTileStale: (key: string) => boolean;
  onFinally: (key: string) => void;
  onCompactInput: (
    request: PendingVoxelFetchRequest,
    input: PendingVoxelCompactInput,
  ) => void;
  onCapacityRetry?: (
    request: PendingVoxelFetchRequest,
    retryAfterMs: number,
  ) => void;
  onDemandState?: (
    request: PendingVoxelFetchRequest,
    state: "known-missing" | "retry-exhausted" | "retry-delayed",
  ) => void;
  includeHaloEmitters?: boolean;
  bakeEmissiveAttributes?: boolean;
}): Promise<void> {
  const {
    request,
    controller,
    activeVoxelRequestKeysRef,
    loadedVoxelsRef,
    loadingVoxelsRef,
    missingVoxelsRef,
    failedVoxelsRef,
    isVoxelTileStale,
    onFinally,
    onCompactInput,
    onCapacityRetry,
    onDemandState,
    includeHaloEmitters = true,
    bakeEmissiveAttributes = true,
  } = args;
  const { key, lod, regionX, regionY } = request;

  try {
    const requestStartedAt = performance.now();
    // Debug-only voxel-lighting diagnostic: `halo=0` asks the server to omit
    // neighboring-region halo emitter records so halo cost can be isolated.
    const diagnosticQuery = includeHaloEmitters ? "" : "?halo=0";
    const res = await fetch(
      `/api/voxels/${lod}/${regionX}/${regionY}${diagnosticQuery}`,
      {
        signal: controller.signal,
      },
    );
    if (
      !activeVoxelRequestKeysRef.current.has(key) &&
      !(loadedVoxelsRef.current.has(key) && isVoxelTileStale(key))
    ) {
      loadingVoxelsRef.current.delete(key);
      return;
    }
    if (res.status === 204) {
      missingVoxelsRef.current.add(key);
      loadingVoxelsRef.current.delete(key);
      onDemandState?.(request, "known-missing");
      return;
    }
    const capacityRetryAfterMs = readCapacityRetryAfterMs(res);
    if (capacityRetryAfterMs !== null) {
      loadingVoxelsRef.current.delete(key);
      onDemandState?.(request, "retry-delayed");
      onCapacityRetry?.(request, capacityRetryAfterMs);
      return;
    }
    if (!res.ok) {
      failedVoxelsRef.current.set(
        key,
        (failedVoxelsRef.current.get(key) ?? 0) + 1,
      );
      loadingVoxelsRef.current.delete(key);
      onDemandState?.(request, "retry-exhausted");
      return;
    }

    const buffer = await res.arrayBuffer();
    const fetchMs = performance.now() - requestStartedAt;
    const resourceEntries = performance.getEntriesByName(res.url);
    let resourceTiming: PerformanceResourceTiming | undefined;
    for (let i = resourceEntries.length - 1; i >= 0; i--) {
      const entry = resourceEntries[i];
      if (entry?.entryType === "resource") {
        resourceTiming = entry as PerformanceResourceTiming;
        break;
      }
    }
    if (
      !activeVoxelRequestKeysRef.current.has(key) &&
      !(loadedVoxelsRef.current.has(key) && isVoxelTileStale(key))
    ) {
      loadingVoxelsRef.current.delete(key);
      return;
    }

    onCompactInput(request, {
      buffer,
      lod,
      regionX,
      regionY,
      bakeEmissiveAttributes,
      benchmark: {
        fetchCompletedAt: performance.now(),
        fetchMs,
        transferBytes: resourceTiming?.transferSize ?? null,
        encodedBodyBytes: resourceTiming?.encodedBodySize ?? null,
        decodedBodyBytes: resourceTiming?.decodedBodySize ?? null,
        rawBufferBytes: buffer.byteLength,
        contentEncoding: res.headers.get("content-encoding"),
        serverRunMs: readNullableHeaderMs(res, "x-voxel-run-ms"),
        serverHaloMs: readNullableHeaderMs(res, "x-voxel-halo-ms"),
        emitterMetadataBytes: readNullableHeaderMs(
          res,
          "x-voxel-emitter-metadata-bytes",
        ),
        emitterPowerMin: readNullableHeaderMs(res, "x-voxel-emitter-power-min"),
        emitterPowerMax: readNullableHeaderMs(res, "x-voxel-emitter-power-max"),
        emitterRadiusMin: readNullableHeaderMs(
          res,
          "x-voxel-emitter-radius-min",
        ),
        emitterRadiusMax: readNullableHeaderMs(
          res,
          "x-voxel-emitter-radius-max",
        ),
        cacheOutcome: readCacheOutcome(res),
      },
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      loadingVoxelsRef.current.delete(key);
      return;
    }

    if (activeVoxelRequestKeysRef.current.has(key)) {
      failedVoxelsRef.current.set(
        key,
        (failedVoxelsRef.current.get(key) ?? 0) + 1,
      );
      onDemandState?.(request, "retry-exhausted");
    }
    loadingVoxelsRef.current.delete(key);
  } finally {
    onFinally(key);
  }
}

function readCapacityRetryAfterMs(res: Response): number | null {
  if (res.status !== 503) return null;
  const raw = res.headers.get("retry-after");
  if (raw === null) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

export function scheduleVoxelCapacityRetry(args: {
  request: PendingVoxelFetchRequest;
  retryAfterMs: number;
  retryNotBeforeRef: { current: Map<string, number> };
  activeVoxelRequestKeysRef: { current: Set<string> };
  loadedVoxelsRef: { current: Map<string, LoadedVoxelTile> };
  isVoxelTileStale: (key: string) => boolean;
  requestVoxelRegion: (request: PendingVoxelFetchRequest) => void;
}): void {
  const {
    request,
    retryAfterMs,
    retryNotBeforeRef,
    activeVoxelRequestKeysRef,
    loadedVoxelsRef,
    isVoxelTileStale,
    requestVoxelRegion,
  } = args;
  const deadline = performance.now() + retryAfterMs;
  retryNotBeforeRef.current.set(request.key, deadline);
  setTimeout(() => {
    if (retryNotBeforeRef.current.get(request.key) !== deadline) return;
    retryNotBeforeRef.current.delete(request.key);
    if (
      activeVoxelRequestKeysRef.current.has(request.key) ||
      (loadedVoxelsRef.current.has(request.key) &&
        isVoxelTileStale(request.key))
    ) {
      requestVoxelRegion(request);
    }
  }, retryAfterMs);
}
