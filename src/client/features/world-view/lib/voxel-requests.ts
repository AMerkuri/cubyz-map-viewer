import { VOXEL_EMITTED_LIGHT } from "./daylight.js";
import type {
  LoadedVoxelTile,
  PendingVoxelFetchRequest,
  PendingVoxelMeshItem,
  VoxelEmitterRecord,
  VoxelRefreshState,
  WorkerIn,
} from "./types.js";
import { regionWorldSize } from "./utils.js";

export function compareVoxelFetchRequests(
  a: PendingVoxelFetchRequest,
  b: PendingVoxelFetchRequest,
): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  return b.generation - a.generation;
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

export function collectLoadedNeighborHaloEmitters(args: {
  lod: number;
  regionX: number;
  regionY: number;
  key: string;
  loadedVoxels: Map<string, LoadedVoxelTile>;
}): { records: VoxelEmitterRecord[]; sourceKeys: string[] } {
  const { lod, regionX, regionY, key, loadedVoxels } = args;
  if (lod !== 1) return { records: [], sourceKeys: [] };

  const radius = VOXEL_EMITTED_LIGHT.radius;
  const size = regionWorldSize(lod);
  const minX = regionX - radius;
  const maxX = regionX + size + radius;
  const minY = regionY - radius;
  const maxY = regionY + size + radius;
  const records: VoxelEmitterRecord[] = [];
  const sourceKeys: string[] = [];

  for (const [sourceKey, tile] of loadedVoxels) {
    if (
      sourceKey === key ||
      tile.lod !== 1 ||
      tile.emitterRecords.length === 0
    ) {
      continue;
    }

    const firstRecordIndex = records.length;
    for (const emitter of tile.emitterRecords) {
      if (
        emitter.x >= minX &&
        emitter.x <= maxX &&
        emitter.y >= minY &&
        emitter.y <= maxY
      ) {
        records.push(emitter);
      }
    }
    if (records.length > firstRecordIndex) {
      sourceKeys.push(sourceKey);
    }
  }

  return { records, sourceKeys };
}

export async function fetchVoxelRegion(args: {
  request: PendingVoxelFetchRequest;
  controller: AbortController;
  workerRef: { current: Worker | null };
  activeVoxelRequestKeysRef: { current: Set<string> };
  loadedVoxelsRef: { current: Map<string, LoadedVoxelTile> };
  loadingVoxelsRef: { current: Set<string> };
  missingVoxelsRef: { current: Set<string> };
  failedVoxelsRef: { current: Map<string, number> };
  isVoxelTileStale: (key: string) => boolean;
  onFinally: (key: string) => void;
}): Promise<void> {
  const {
    request,
    controller,
    workerRef,
    activeVoxelRequestKeysRef,
    loadedVoxelsRef,
    loadingVoxelsRef,
    missingVoxelsRef,
    failedVoxelsRef,
    isVoxelTileStale,
    onFinally,
  } = args;
  const { key, lod, regionX, regionY, version } = request;

  try {
    const requestStartedAt = performance.now();
    const res = await fetch(`/api/voxels/${lod}/${regionX}/${regionY}`, {
      signal: controller.signal,
    });
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
      return;
    }
    if (!res.ok) {
      failedVoxelsRef.current.set(
        key,
        (failedVoxelsRef.current.get(key) ?? 0) + 1,
      );
      loadingVoxelsRef.current.delete(key);
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
      !workerRef.current ||
      (!activeVoxelRequestKeysRef.current.has(key) &&
        !(loadedVoxelsRef.current.has(key) && isVoxelTileStale(key)))
    ) {
      loadingVoxelsRef.current.delete(key);
      return;
    }

    const haloEmitters = collectLoadedNeighborHaloEmitters({
      lod,
      regionX,
      regionY,
      key,
      loadedVoxels: loadedVoxelsRef.current,
    });

    workerRef.current.postMessage(
      {
        buffer,
        lod,
        regionX,
        regionY,
        haloEmitterRecords: haloEmitters.records,
        haloEmitterSourceKeys: haloEmitters.sourceKeys,
        version,
        benchmark: {
          fetchCompletedAt: performance.now(),
          fetchMs,
          transferBytes: resourceTiming?.transferSize ?? null,
          encodedBodyBytes: resourceTiming?.encodedBodySize ?? null,
          decodedBodyBytes: resourceTiming?.decodedBodySize ?? null,
          rawBufferBytes: buffer.byteLength,
          contentEncoding: res.headers.get("content-encoding"),
        },
      } satisfies WorkerIn,
      [buffer],
    );
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
    }
    loadingVoxelsRef.current.delete(key);
  } finally {
    onFinally(key);
  }
}
