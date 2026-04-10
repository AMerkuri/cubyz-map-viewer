import { createHash } from "crypto";

import { LRUCache } from "./cache.js";
import { VoxelWorkerPool, type InstrumentedPoolResult } from "./voxel-worker-pool.js";
import type { BlockColorTable } from "./block-color-table.js";
import type { VoxelGenerationStats, VoxelJobResult } from "../workers/voxel-worker-protocol.js";

interface CachedVoxelMesh {
  buf: Buffer;
  etag: string;
}

interface VoxelMeshResponse {
  status: "ok" | "empty";
  buf?: Buffer;
  etag?: string;
  metrics: VoxelRequestMetrics;
}

interface InFlightJob {
  versionedKey: string;
  promise: Promise<InstrumentedPoolResult>;
}

interface RollingMetric {
  sum: number;
  max: number;
  count: number;
}

export interface VoxelRequestMetrics {
  source: "cache" | "worker";
  queueMs: number;
  runMs: number;
  totalMs: number;
  queueDepth: number;
  runningJobs: number;
  inFlightJobs: number;
  byteLength: number;
  cacheTier?: VoxelGenerationStats["cacheTier"];
  quadCount?: number;
  chunkColumns?: number;
  regionsParsed?: number;
  chunksMeshed?: number;
  visitedAirCells?: number;
  facesBeforeMerge?: number;
  minWorldZ?: number;
  maxWorldZ?: number;
}

export interface VoxelServiceMetricsSnapshot {
  workers: number;
  queueDepth: number;
  runningJobs: number;
  inFlightJobs: number;
  cacheEntries: number;
  requests: number;
  cacheHits: number;
  workerRequests: number;
  emptyResponses: number;
  staleDrops: number;
  errors: number;
  queueMsAvg: number;
  queueMsMax: number;
  runMsAvg: number;
  runMsMax: number;
  totalMsAvg: number;
  totalMsMax: number;
}

export class VoxelMeshService {
  private readonly pool: VoxelWorkerPool;
  private readonly cache = new LRUCache<string, CachedVoxelMesh>(256);
  private readonly inFlight = new Map<string, InFlightJob>();
  private globalEpoch = 0;
  private nextJobId = 1;
  private readonly keyEpochs = new Map<string, number>();
  private requests = 0;
  private cacheHits = 0;
  private workerRequests = 0;
  private emptyResponses = 0;
  private staleDrops = 0;
  private errors = 0;
  private readonly queueMetric: RollingMetric = { sum: 0, max: 0, count: 0 };
  private readonly runMetric: RollingMetric = { sum: 0, max: 0, count: 0 };
  private readonly totalMetric: RollingMetric = { sum: 0, max: 0, count: 0 };

  constructor(savePath: string, blockColors: BlockColorTable, workerCount?: number) {
    this.pool = new VoxelWorkerPool(savePath, blockColors, workerCount);
  }

  async start(): Promise<void> {
    await this.pool.start();
  }

  async destroy(): Promise<void> {
    await this.pool.destroy();
  }

  clear(key: string): void {
    this.cache.delete(key);
    this.keyEpochs.set(key, (this.keyEpochs.get(key) ?? 0) + 1);
  }

  clearAll(): void {
    this.cache.clear();
    this.globalEpoch++;
  }

  getMetricsSnapshot(): VoxelServiceMetricsSnapshot {
    return {
      workers: this.pool.getWorkerCount(),
      queueDepth: this.pool.getQueueDepth(),
      runningJobs: this.pool.getRunningCount(),
      inFlightJobs: this.inFlight.size,
      cacheEntries: this.cache.size,
      requests: this.requests,
      cacheHits: this.cacheHits,
      workerRequests: this.workerRequests,
      emptyResponses: this.emptyResponses,
      staleDrops: this.staleDrops,
      errors: this.errors,
      queueMsAvg: this.average(this.queueMetric),
      queueMsMax: this.queueMetric.max,
      runMsAvg: this.average(this.runMetric),
      runMsMax: this.runMetric.max,
      totalMsAvg: this.average(this.totalMetric),
      totalMsMax: this.totalMetric.max,
    };
  }

  async getVoxelMesh(key: string, lod: number, regionX: number, regionY: number): Promise<VoxelMeshResponse> {
    this.requests++;
    const startedAt = performance.now();
    const cached = this.cache.get(key);
    if (cached) {
      this.cacheHits++;
      const totalMs = performance.now() - startedAt;
      this.recordMetric(this.totalMetric, totalMs);
      return {
        status: "ok",
        buf: cached.buf,
        etag: cached.etag,
        metrics: {
          source: "cache",
          queueMs: 0,
          runMs: 0,
          totalMs,
          queueDepth: this.pool.getQueueDepth(),
          runningJobs: this.pool.getRunningCount(),
          inFlightJobs: this.inFlight.size,
          byteLength: cached.buf.byteLength,
          cacheTier: "worker",
        },
      };
    }

    const globalEpoch = this.globalEpoch;
    const keyEpoch = this.keyEpochs.get(key) ?? 0;
    const versionedKey = `${key}@${globalEpoch}:${keyEpoch}`;
    const existing = this.inFlight.get(key);
    const promise = existing && existing.versionedKey === versionedKey
      ? existing.promise
      : this.enqueueJob(key, lod, regionX, regionY, globalEpoch, keyEpoch, versionedKey);

    const { result, queueMs, runMs } = await promise;
    const safeQueueMs = Number.isFinite(queueMs) ? queueMs : 0;
    const safeRunMs = Number.isFinite(runMs) ? runMs : 0;
    this.workerRequests++;
    this.recordMetric(this.queueMetric, safeQueueMs);
    this.recordMetric(this.runMetric, safeRunMs);
    const totalMs = performance.now() - startedAt;
    this.recordMetric(this.totalMetric, totalMs);
    const metrics: VoxelRequestMetrics = {
      source: "worker",
      queueMs: safeQueueMs,
      runMs: safeRunMs,
      totalMs,
      queueDepth: this.pool.getQueueDepth(),
      runningJobs: this.pool.getRunningCount(),
      inFlightJobs: this.inFlight.size,
      byteLength: result.status === "ok" ? result.buffer.byteLength : 0,
      cacheTier: result.stats?.cacheTier,
      quadCount: result.stats?.quadCount,
      chunkColumns: result.stats?.chunkColumns,
      regionsParsed: result.stats?.regionsParsed,
      chunksMeshed: result.stats?.chunksMeshed,
      visitedAirCells: result.stats?.visitedAirCells,
      facesBeforeMerge: result.stats?.facesBeforeMerge,
      minWorldZ: result.stats?.minWorldZ,
      maxWorldZ: result.stats?.maxWorldZ,
    };

    if (result.status === "empty") {
      this.emptyResponses++;
      return { status: "empty", metrics };
    }
    if (result.status === "error") {
      this.errors++;
      throw new Error(result.error);
    }

    if (!this.isCurrentEpoch(key, result.globalEpoch, result.keyEpoch)) {
      this.staleDrops++;
      return { status: "empty", metrics };
    }

    const responseBuffer = Buffer.from(result.buffer);
    const etag = `"voxels-${key}-${createHash("sha1").update(responseBuffer).digest("hex")}"`;
    this.cache.set(key, { buf: responseBuffer, etag });
    return { status: "ok", buf: responseBuffer, etag, metrics };
  }

  private enqueueJob(
    key: string,
    lod: number,
    regionX: number,
    regionY: number,
    globalEpoch: number,
    keyEpoch: number,
    versionedKey: string,
  ): Promise<InstrumentedPoolResult> {
    const promise = this.pool.run({
      id: this.nextJobId++,
      key,
      lod,
      regionX,
      regionY,
      globalEpoch,
      keyEpoch,
    }).finally(() => {
      const inFlight = this.inFlight.get(key);
      if (inFlight?.versionedKey === versionedKey) {
        this.inFlight.delete(key);
      }
    });
    this.inFlight.set(key, { versionedKey, promise });
    return promise;
  }

  private isCurrentEpoch(key: string, globalEpoch: number, keyEpoch: number): boolean {
    return globalEpoch === this.globalEpoch && keyEpoch === (this.keyEpochs.get(key) ?? 0);
  }

  private recordMetric(metric: RollingMetric, value: number): void {
    metric.sum += value;
    metric.count++;
    if (value > metric.max) metric.max = value;
  }

  private average(metric: RollingMetric): number {
    return metric.count > 0 ? metric.sum / metric.count : 0;
  }
}
