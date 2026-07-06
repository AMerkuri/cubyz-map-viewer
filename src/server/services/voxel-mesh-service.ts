import { promisify } from "node:util";
import { brotliCompress, gzip, constants as zlibConstants } from "node:zlib";
import type { VoxelGenerationStats } from "../workers/voxel-worker-protocol.js";
import type { BlockColorTable } from "./block-color-table.js";
import type { BlockShapeTable } from "./block-shape-table.js";
import { LRUCache } from "./cache.js";
import { generateSignRecords, type SignRecord } from "./sign-records.js";
import { computeVoxelSourceSignature } from "./voxel-source-signature.js";
import {
  type InstrumentedPoolResult,
  VoxelWorkerPool,
} from "./voxel-worker-pool.js";

interface CachedVoxelMesh {
  key: string;
  buf: Buffer;
  sourceSignature: string;
  cacheTier: VoxelGenerationStats["cacheTier"];
  variants: Map<VoxelContentEncoding, CachedVoxelVariant>;
  variantJobs: Map<CompressedVoxelEncoding, Promise<CachedVoxelVariant>>;
}

interface CachedVoxelVariant {
  buf: Buffer;
  etag: string;
}

interface VoxelEncodingBenchmark {
  encoding: VoxelContentEncoding;
  byteLength: number;
  generateMs: number;
}

interface VoxelMeshBenchmark {
  key: string;
  rawByteLength: number;
  variants: VoxelEncodingBenchmark[];
}

interface VoxelMeshResponse {
  status: "ok" | "empty";
  buf?: Buffer;
  etag?: string;
  contentEncoding?: CompressedVoxelEncoding;
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

type CompressedVoxelEncoding = "br" | "gzip";

export type VoxelContentEncoding = CompressedVoxelEncoding | "identity";

const brotliCompressAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

interface VoxelCompressionConfig {
  brotliQuality: number;
  brotliLgwin: number;
  gzipLevel: number;
}

interface VoxelRequestMetrics {
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

interface VoxelServiceMetricsSnapshot {
  workers: number;
  workerRuntimeMode: "source" | "dist";
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
  private readonly cache: LRUCache<string, CachedVoxelMesh>;
  private readonly savePath: string;
  private readonly compressionConfig: VoxelCompressionConfig;
  private readonly blockShapes: BlockShapeTable;
  private readonly blockShapeSignature: string;
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

  constructor(
    savePath: string,
    blockColors: BlockColorTable,
    blockShapes: BlockShapeTable,
    workerCount?: number,
    cacheSize = 1024,
    compressionConfig: VoxelCompressionConfig = {
      brotliQuality: 5,
      brotliLgwin: 20,
      gzipLevel: 6,
    },
  ) {
    this.savePath = savePath;
    this.blockShapes = blockShapes;
    this.blockShapeSignature = blockShapes.signature;
    this.pool = new VoxelWorkerPool(
      savePath,
      blockColors,
      blockShapes,
      workerCount,
    );
    this.cache = new LRUCache<string, CachedVoxelMesh>(cacheSize);
    this.compressionConfig = compressionConfig;
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
      workerRuntimeMode: this.pool.getRuntimeMode(),
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

  async getCurrentEtag(
    key: string,
    lod: number,
    regionX: number,
    regionY: number,
    contentEncoding: VoxelContentEncoding,
  ): Promise<string | null> {
    const cached = this.cache.get(key);
    if (cached) {
      return this.buildVariantEtag(
        key,
        cached.sourceSignature,
        contentEncoding,
      );
    }

    const sourceSignature = await computeVoxelSourceSignature({
      savePath: this.savePath,
      blockShapeSignature: this.blockShapeSignature,
      lod,
      regionX,
      regionY,
    });
    if (!sourceSignature) {
      return null;
    }

    return this.buildVariantEtag(key, sourceSignature, contentEncoding);
  }

  async getVoxelMesh(
    key: string,
    lod: number,
    regionX: number,
    regionY: number,
    contentEncoding: VoxelContentEncoding,
  ): Promise<VoxelMeshResponse> {
    this.requests++;
    const startedAt = performance.now();
    const cached = this.cache.get(key);
    if (cached) {
      const variant = await this.getVariant(cached, contentEncoding);
      this.cacheHits++;
      const totalMs = performance.now() - startedAt;
      this.recordMetric(this.totalMetric, totalMs);
      return {
        status: "ok",
        buf: variant.buf,
        etag: variant.etag,
        contentEncoding:
          contentEncoding === "identity" ? undefined : contentEncoding,
        metrics: {
          source: "cache",
          queueMs: 0,
          runMs: 0,
          totalMs,
          queueDepth: this.pool.getQueueDepth(),
          runningJobs: this.pool.getRunningCount(),
          inFlightJobs: this.inFlight.size,
          byteLength: variant.buf.byteLength,
          cacheTier: cached.cacheTier,
        },
      };
    }

    const globalEpoch = this.globalEpoch;
    const keyEpoch = this.keyEpochs.get(key) ?? 0;
    const versionedKey = `${key}@${globalEpoch}:${keyEpoch}`;
    const existing = this.inFlight.get(key);
    const promise =
      existing && existing.versionedKey === versionedKey
        ? existing.promise
        : this.enqueueJob(
            key,
            lod,
            regionX,
            regionY,
            globalEpoch,
            keyEpoch,
            versionedKey,
          );

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

    const sourceSignature = await computeVoxelSourceSignature({
      savePath: this.savePath,
      blockShapeSignature: this.blockShapeSignature,
      lod,
      regionX,
      regionY,
    });
    if (!sourceSignature) {
      this.emptyResponses++;
      return { status: "empty", metrics };
    }

    const responseBuffer = Buffer.from(result.buffer);
    const variants = new Map<VoxelContentEncoding, CachedVoxelVariant>();
    variants.set("identity", {
      buf: responseBuffer,
      etag: this.buildVariantEtag(key, sourceSignature, "identity"),
    });
    const cachedMesh: CachedVoxelMesh = {
      key,
      buf: responseBuffer,
      sourceSignature,
      cacheTier: result.stats?.cacheTier ?? "worker",
      variants,
      variantJobs: new Map(),
    };
    this.cache.set(key, cachedMesh);
    const variant = await this.getVariant(cachedMesh, contentEncoding);
    return {
      status: "ok",
      buf: variant.buf,
      etag: variant.etag,
      contentEncoding:
        contentEncoding === "identity" ? undefined : contentEncoding,
      metrics: {
        ...metrics,
        byteLength: variant.buf.byteLength,
      },
    };
  }

  /**
   * Return sign records for a region column at the given LOD. Sign text is
   * gated to the sign LOD (1); other LODs return an empty array. Records are
   * derived from the region parser's block-entity stream joined against the
   * block shape table, keeping the binary voxel mesh payload geometry-only.
   */
  async getSignRecords(
    lod: number,
    regionX: number,
    regionY: number,
  ): Promise<SignRecord[]> {
    return generateSignRecords(
      this.savePath,
      this.blockShapes,
      lod,
      regionX,
      regionY,
    );
  }

  async benchmarkVoxelMesh(
    key: string,
    lod: number,
    regionX: number,
    regionY: number,
    fresh = false,
  ): Promise<VoxelMeshBenchmark | null> {
    const response = await this.getVoxelMesh(
      key,
      lod,
      regionX,
      regionY,
      "identity",
    );
    if (response.status !== "ok" || !response.buf) {
      return null;
    }
    const cached = this.cache.get(key);
    if (!cached) {
      return null;
    }

    const variants: VoxelEncodingBenchmark[] = [
      {
        encoding: "identity",
        byteLength: cached.buf.byteLength,
        generateMs: 0,
      },
      {
        encoding: "gzip",
        byteLength: 0,
        generateMs: 0,
      },
      {
        encoding: "br",
        byteLength: 0,
        generateMs: 0,
      },
    ];
    for (const [index, encoding] of (["gzip", "br"] as const).entries()) {
      const startedAt = performance.now();
      const variant = fresh
        ? await this.compressVariant(cached, encoding)
        : await this.getVariant(cached, encoding);
      variants[index + 1] = {
        encoding,
        byteLength: variant.buf.byteLength,
        generateMs: performance.now() - startedAt,
      };
    }

    return {
      key,
      rawByteLength: cached.buf.byteLength,
      variants,
    };
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
    const promise = this.pool
      .run({
        id: this.nextJobId++,
        key,
        lod,
        regionX,
        regionY,
        globalEpoch,
        keyEpoch,
      })
      .finally(() => {
        const inFlight = this.inFlight.get(key);
        if (inFlight?.versionedKey === versionedKey) {
          this.inFlight.delete(key);
        }
      });
    this.inFlight.set(key, { versionedKey, promise });
    return promise;
  }

  private isCurrentEpoch(
    key: string,
    globalEpoch: number,
    keyEpoch: number,
  ): boolean {
    return (
      globalEpoch === this.globalEpoch &&
      keyEpoch === (this.keyEpochs.get(key) ?? 0)
    );
  }

  private recordMetric(metric: RollingMetric, value: number): void {
    metric.sum += value;
    metric.count++;
    if (value > metric.max) metric.max = value;
  }

  private average(metric: RollingMetric): number {
    return metric.count > 0 ? metric.sum / metric.count : 0;
  }

  private async getVariant(
    cached: CachedVoxelMesh,
    contentEncoding: VoxelContentEncoding,
  ): Promise<CachedVoxelVariant> {
    const existing = cached.variants.get(contentEncoding);
    if (existing) {
      return existing;
    }
    if (contentEncoding === "identity") {
      throw new Error("Missing identity voxel variant");
    }
    const inFlight = cached.variantJobs.get(contentEncoding);
    if (inFlight) {
      return inFlight;
    }
    const job = this.compressVariant(cached, contentEncoding)
      .then((variant) => {
        cached.variants.set(contentEncoding, variant);
        cached.variantJobs.delete(contentEncoding);
        return variant;
      })
      .catch((error) => {
        cached.variantJobs.delete(contentEncoding);
        throw error;
      });
    cached.variantJobs.set(contentEncoding, job);
    return job;
  }

  private async compressVariant(
    cached: CachedVoxelMesh,
    contentEncoding: CompressedVoxelEncoding,
  ): Promise<CachedVoxelVariant> {
    const compressed =
      contentEncoding === "br"
        ? await brotliCompressAsync(cached.buf, {
            params: {
              [zlibConstants.BROTLI_PARAM_MODE]:
                zlibConstants.BROTLI_MODE_GENERIC,
              [zlibConstants.BROTLI_PARAM_QUALITY]:
                this.compressionConfig.brotliQuality,
              [zlibConstants.BROTLI_PARAM_LGWIN]:
                this.compressionConfig.brotliLgwin,
              [zlibConstants.BROTLI_PARAM_SIZE_HINT]: cached.buf.byteLength,
            },
          })
        : await gzipAsync(cached.buf, {
            level: this.compressionConfig.gzipLevel,
          });
    return {
      buf: compressed,
      etag: this.buildVariantEtag(
        cached.key,
        cached.sourceSignature,
        contentEncoding,
      ),
    };
  }

  private buildVariantEtag(
    key: string,
    sourceSignature: string,
    contentEncoding: VoxelContentEncoding,
  ): string {
    return `"voxels-${key}-${contentEncoding}-${sourceSignature}"`;
  }
}
