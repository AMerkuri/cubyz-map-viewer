import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { brotliCompress, gzip, constants as zlibConstants } from "node:zlib";
import type { VoxelGenerationStats } from "../workers/voxel-worker-protocol.js";
import type { BlockColorTable } from "./block-color-table.js";
import type { BlockShapeTable } from "./block-shape-table.js";
import { WeightedLRUCache } from "./cache.js";
import { generateSignRecords, type SignRecord } from "./sign-records.js";
import {
  EMITTER_SUMMARY_LODS,
  type EmitterSummaryCluster,
  type EmitterSummaryResult,
  getEmitterSummaryRadius,
} from "./voxel-emitter-aggregation.js";
import type {
  VoxelEmitterSummaryCacheMetrics,
  VoxelEmitterSummaryServiceOptions,
} from "./voxel-emitter-summary-service.js";
import { VoxelEmitterSummaryService } from "./voxel-emitter-summary-service.js";
import { computeVoxelSourceSignature } from "./voxel-source-signature.js";
import { resolveVoxelWorkerCount } from "./voxel-worker-config.js";
import {
  type InstrumentedPoolResult,
  VoxelQueuedJobCancelledError,
  type VoxelWorkerAdmissionMetrics,
  VoxelWorkerPool,
  type VoxelWorkerPoolDiagnostics,
  type VoxelWorkerPoolOptions,
} from "./voxel-worker-pool.js";

interface CachedVoxelMesh {
  key: string;
  globalEpoch: number;
  keyEpoch: number;
  buf: Buffer;
  sourceSignature: string;
  cacheTier: VoxelGenerationStats["cacheTier"];
  stats?: VoxelGenerationStats;
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
  metrics?: Pick<
    VoxelGenerationStats,
    | "quadCount"
    | "greedyCubeQuads"
    | "modelQuads"
    | "droppedModelQuads"
    | "modelQuadBudget"
    | "transparentQuads"
    | "rawPayloadBytes"
    | "greedyRecordBytes"
    | "modelRecordBytes"
    | "emitterRecords"
    | "ownEmitterRecords"
    | "haloEmitterRecords"
    | "aggregatedEmitterRecords"
    | "emitterRecordBytes"
    | "emitterMetadataBytes"
    | "emitterPowerMin"
    | "emitterPowerMax"
    | "emitterRadiusMin"
    | "emitterRadiusMax"
    | "summaryCacheOutcome"
    | "summaryBuildMs"
    | "summaryLeafParses"
    | "summaryRawSourceCount"
    | "summaryRetainedClusterCount"
    | "summaryCappedClusterCount"
    | "externalRegionParses"
    | "externalRegionCacheHits"
    | "externalRegionMisses"
    | "externalRegionParseErrors"
    | "cacheTier"
  >;
  variants: VoxelEncodingBenchmark[];
}

export interface VoxelMeshResponse {
  status: "ok" | "empty";
  buf?: Buffer;
  etag?: string;
  contentEncoding?: CompressedVoxelEncoding;
  metrics: VoxelRequestMetrics;
}

interface InFlightJob {
  versionedKey: string;
  jobId: number;
  consumers: number;
  queuedCancelled: boolean;
  orphaned: boolean;
  invalidated: boolean;
  settled: boolean;
  promise: Promise<PipelineResult>;
}

interface PipelineResult {
  instrumented?: InstrumentedPoolResult;
  cachedMesh?: CachedVoxelMesh;
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

export interface VoxelRequestMetrics {
  source: "cache" | "worker";
  cacheOutcome: "hit" | "miss" | "unknown";
  queueMs: number;
  runMs: number;
  totalMs: number;
  queueDepth: number;
  runningJobs: number;
  inFlightJobs: number;
  byteLength: number;
  cacheTier?: VoxelGenerationStats["cacheTier"];
  quadCount?: number;
  greedyCubeQuads?: number;
  modelQuads?: number;
  droppedModelQuads?: number;
  modelQuadBudget?: number;
  transparentQuads?: number;
  rawPayloadBytes?: number;
  greedyRecordBytes?: number;
  modelRecordBytes?: number;
  emitterRecords?: number;
  ownEmitterRecords?: number;
  haloEmitterRecords?: number;
  aggregatedEmitterRecords?: number;
  haloMs?: number;
  cachedHaloMs?: number;
  emitterRecordBytes?: number;
  emitterMetadataBytes?: number;
  emitterPowerMin?: number;
  emitterPowerMax?: number;
  emitterRadiusMin?: number;
  emitterRadiusMax?: number;
  summaryCacheOutcome?: VoxelGenerationStats["summaryCacheOutcome"];
  summaryBuildMs?: number;
  summaryLeafParses?: number;
  summaryRawSourceCount?: number;
  summaryRetainedClusterCount?: number;
  summaryCappedClusterCount?: number;
  chunkColumns?: number;
  regionsParsed?: number;
  chunksMeshed?: number;
  visitedAirCells?: number;
  facesBeforeMerge?: number;
  externalRegionParses?: number;
  externalRegionCacheHits?: number;
  externalRegionMisses?: number;
  externalRegionParseErrors?: number;
  minWorldZ?: number;
  maxWorldZ?: number;
}

export interface VoxelServiceMetricsSnapshot {
  workers: number;
  workerRuntimeMode: "source" | "dist";
  queueDepth: number;
  queueLimit: number;
  admissionAccepted: number;
  admissionRejected: number;
  queuedCancellations: number;
  runningJobs: number;
  workerDiagnostics?: VoxelWorkerPoolDiagnostics | null;
  inFlightJobs: number;
  inFlightConsumers: number;
  sharedPipelineConsumers: number;
  consumerCancellations: number;
  runningOrphans: number;
  orphanRejoins: number;
  orphanCompletions: number;
  mainProcessMemory: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
    arrayBuffers: number;
  };
  cacheEntries: number;
  cacheBytes: number;
  cacheRawBytes: number;
  cacheVariantBytes: number;
  cacheEvictions: number;
  cacheOversizedSkips: number;
  summaryCacheEntries: number;
  summaryCacheEstimatedBytes: number;
  summaryCacheRetainedClusters: number;
  summaryCacheEvictions: number;
  summaryCacheOversizedSkips: number;
  summaryActiveWork: number;
  summaryNodeRequests: number;
  summaryNodeMemoryHits: number;
  summaryNodeDiskHits: number;
  summaryNodeBuilds: number;
  summaryLeafExtractions: number;
  summaryExtractedSources: number;
  summaryLeafBuildLimit: number;
  summaryLeafBuildActive: number;
  summaryLeafBuildQueued: number;
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

export interface VoxelWorkerPoolLike {
  start(): Promise<void>;
  destroy(): Promise<void>;
  run(
    request: Parameters<VoxelWorkerPool["run"]>[0],
  ): Promise<InstrumentedPoolResult>;
  cancelQueued(jobId: number): boolean;
  getWorkerCount(): number;
  getRuntimeMode(): "source" | "dist";
  getQueueDepth(): number;
  getQueueLimit(): number;
  getAdmissionMetrics(): VoxelWorkerAdmissionMetrics;
  getRunningCount(): number;
  getDiagnosticsSnapshot?(): VoxelWorkerPoolDiagnostics;
}

export interface VoxelEmitterSummaryServiceLike {
  getNode: VoxelEmitterSummaryService["getNode"];
  invalidate: VoxelEmitterSummaryService["invalidate"];
  clear: VoxelEmitterSummaryService["clear"];
  getMetricsSnapshot(): VoxelEmitterSummaryCacheMetrics;
}

interface VoxelMeshServiceDependencies {
  pool?: VoxelWorkerPoolLike;
  workerPoolOptions?: VoxelWorkerPoolOptions;
  emitterSummaries?: VoxelEmitterSummaryServiceLike;
  emitterSummaryOptions?: VoxelEmitterSummaryServiceOptions;
  computeSourceSignature?: typeof computeVoxelSourceSignature;
}

export interface VoxelMeshServiceApi {
  getCurrentEtag(
    key: string,
    lod: number,
    regionX: number,
    regionY: number,
    contentEncoding: VoxelContentEncoding,
  ): Promise<string | null>;
  getVoxelMesh(
    key: string,
    lod: number,
    regionX: number,
    regionY: number,
    contentEncoding: VoxelContentEncoding,
    includeHaloEmitters?: boolean,
    signal?: AbortSignal,
  ): Promise<VoxelMeshResponse>;
  getMetricsSnapshot(): VoxelServiceMetricsSnapshot;
  benchmarkVoxelMesh(
    key: string,
    lod: number,
    regionX: number,
    regionY: number,
    fresh?: boolean,
  ): Promise<VoxelMeshBenchmark | null>;
}

export class VoxelMeshService implements VoxelMeshServiceApi {
  private readonly pool: VoxelWorkerPoolLike;
  private readonly cache: WeightedLRUCache<string, CachedVoxelMesh>;
  private readonly savePath: string;
  private readonly compressionConfig: VoxelCompressionConfig;
  private readonly emitterSummaries: VoxelEmitterSummaryServiceLike;
  private readonly computeSourceSignature: typeof computeVoxelSourceSignature;
  private readonly blockShapes: BlockShapeTable;
  private readonly blockShapeSignature: string;
  private readonly blockColorSignature: string;
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
  private sharedPipelineConsumers = 0;
  private consumerCancellations = 0;
  private runningOrphans = 0;
  private orphanRejoins = 0;
  private orphanCompletions = 0;
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
    dependencies: VoxelMeshServiceDependencies = {},
    cacheByteLimit = 256 * 1024 * 1024,
  ) {
    const resolvedWorkerCount =
      workerCount ?? resolveVoxelWorkerCount(undefined);
    this.savePath = savePath;
    this.blockShapes = blockShapes;
    this.blockShapeSignature = blockShapes.signature;
    this.blockColorSignature = blockColors.signature;
    this.pool =
      dependencies.pool ??
      new VoxelWorkerPool(
        savePath,
        blockColors,
        blockShapes,
        resolvedWorkerCount,
        dependencies.workerPoolOptions,
      );
    this.emitterSummaries =
      dependencies.emitterSummaries ??
      new VoxelEmitterSummaryService(savePath, blockColors, blockShapes, 512, {
        ...dependencies.emitterSummaryOptions,
        leafBuildLimit: resolvedWorkerCount,
      });
    this.computeSourceSignature =
      dependencies.computeSourceSignature ?? computeVoxelSourceSignature;
    this.cache = new WeightedLRUCache<string, CachedVoxelMesh>(
      cacheSize,
      cacheByteLimit,
      (mesh) => this.getRetainedBufferBytes(mesh),
    );
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
    this.invalidateInFlight(key);
  }

  clearAll(): void {
    this.cache.clear();
    this.emitterSummaries.clear();
    this.globalEpoch++;
    for (const key of this.inFlight.keys()) this.invalidateInFlight(key);
  }

  invalidateLod1EmitterColumn(regionX: number, regionY: number): void {
    const affectedLeaves = [-128, 0, 128].flatMap((offsetX) =>
      [-128, 0, 128].map(
        (offsetY) => [regionX + offsetX, regionY + offsetY] as const,
      ),
    );
    for (const [leafX, leafY] of affectedLeaves) {
      for (const lod of EMITTER_SUMMARY_LODS) {
        const span = 128 * lod;
        const ancestorX = Math.floor(leafX / span) * span;
        const ancestorY = Math.floor(leafY / span) * span;
        this.emitterSummaries.invalidate(lod, ancestorX, ancestorY);
      }
    }
  }

  getMetricsSnapshot(): VoxelServiceMetricsSnapshot {
    const summaryMetrics = this.emitterSummaries.getMetricsSnapshot();
    const admissionMetrics = this.pool.getAdmissionMetrics();
    const memory = process.memoryUsage();
    return {
      workers: this.pool.getWorkerCount(),
      workerRuntimeMode: this.pool.getRuntimeMode(),
      queueDepth: this.pool.getQueueDepth(),
      queueLimit: this.pool.getQueueLimit(),
      admissionAccepted: admissionMetrics.accepted,
      admissionRejected: admissionMetrics.rejected,
      queuedCancellations: admissionMetrics.queuedCancelled,
      runningJobs: this.pool.getRunningCount(),
      workerDiagnostics: this.pool.getDiagnosticsSnapshot?.() ?? null,
      inFlightJobs: this.inFlight.size,
      inFlightConsumers: [...this.inFlight.values()].reduce(
        (sum, operation) => sum + operation.consumers,
        0,
      ),
      sharedPipelineConsumers: this.sharedPipelineConsumers,
      consumerCancellations: this.consumerCancellations,
      runningOrphans: this.runningOrphans,
      orphanRejoins: this.orphanRejoins,
      orphanCompletions: this.orphanCompletions,
      mainProcessMemory: {
        rss: memory.rss,
        heapUsed: memory.heapUsed,
        heapTotal: memory.heapTotal,
        external: memory.external,
        arrayBuffers: memory.arrayBuffers,
      },
      cacheEntries: this.cache.size,
      cacheBytes: this.cache.weight,
      cacheRawBytes: this.getCacheBufferBytes("identity"),
      cacheVariantBytes:
        this.getCacheBufferBytes("gzip") + this.getCacheBufferBytes("br"),
      cacheEvictions: this.cache.evictions,
      cacheOversizedSkips: this.cache.oversizedSkips,
      summaryCacheEntries: summaryMetrics.entries,
      summaryCacheEstimatedBytes: summaryMetrics.estimatedBytes,
      summaryCacheRetainedClusters: summaryMetrics.retainedClusters,
      summaryCacheEvictions: summaryMetrics.evictions,
      summaryCacheOversizedSkips: summaryMetrics.oversizedSkips,
      summaryActiveWork: summaryMetrics.activeWork,
      summaryNodeRequests: summaryMetrics.nodeRequests,
      summaryNodeMemoryHits: summaryMetrics.nodeMemoryHits,
      summaryNodeDiskHits: summaryMetrics.nodeDiskHits,
      summaryNodeBuilds: summaryMetrics.nodeBuilds,
      summaryLeafExtractions: summaryMetrics.leafExtractions,
      summaryExtractedSources: summaryMetrics.extractedSources,
      summaryLeafBuildLimit: summaryMetrics.leafBuildLimit,
      summaryLeafBuildActive: summaryMetrics.leafBuildActive,
      summaryLeafBuildQueued: summaryMetrics.leafBuildQueued,
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

    const emitterSummary =
      lod > 1 ? await this.getEmitterSummary(lod, regionX, regionY) : undefined;
    const sourceSignature = await this.computeSourceSignature({
      savePath: this.savePath,
      blockShapeSignature: this.blockShapeSignature,
      blockColorSignature: this.blockColorSignature,
      lod,
      regionX,
      regionY,
      emitterSummarySignature: emitterSummary?.node.signature,
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
    includeHaloEmitters = true,
    signal?: AbortSignal,
  ): Promise<VoxelMeshResponse> {
    if (signal?.aborted) throw this.createAbortError();
    this.requests++;
    const startedAt = performance.now();
    const cached = this.cache.get(key);
    if (cached) {
      const variant = await this.waitForConsumer(
        this.getVariant(cached, contentEncoding),
        signal,
      );
      this.cacheHits++;
      const totalMs = performance.now() - startedAt;
      this.recordMetric(this.totalMetric, totalMs);
      const metrics: VoxelRequestMetrics = {
        source: "cache",
        cacheOutcome: "hit",
        queueMs: 0,
        runMs: 0,
        totalMs,
        queueDepth: this.pool.getQueueDepth(),
        runningJobs: this.pool.getRunningCount(),
        inFlightJobs: this.inFlight.size,
        byteLength: variant.buf.byteLength,
        cacheTier: cached.cacheTier,
        quadCount: cached.stats?.quadCount,
        greedyCubeQuads: cached.stats?.greedyCubeQuads,
        modelQuads: cached.stats?.modelQuads,
        droppedModelQuads: cached.stats?.droppedModelQuads,
        modelQuadBudget: cached.stats?.modelQuadBudget,
        transparentQuads: cached.stats?.transparentQuads,
        rawPayloadBytes: cached.stats?.rawPayloadBytes,
        greedyRecordBytes: cached.stats?.greedyRecordBytes,
        modelRecordBytes: cached.stats?.modelRecordBytes,
        emitterRecords: cached.stats?.emitterRecords,
        ownEmitterRecords: cached.stats?.ownEmitterRecords,
        haloEmitterRecords: cached.stats?.haloEmitterRecords,
        aggregatedEmitterRecords: cached.stats?.aggregatedEmitterRecords,
        cachedHaloMs: cached.stats?.haloMs,
        emitterRecordBytes: cached.stats?.emitterRecordBytes,
        emitterMetadataBytes: cached.stats?.emitterMetadataBytes,
        emitterPowerMin: cached.stats?.emitterPowerMin,
        emitterPowerMax: cached.stats?.emitterPowerMax,
        emitterRadiusMin: cached.stats?.emitterRadiusMin,
        emitterRadiusMax: cached.stats?.emitterRadiusMax,
        summaryCacheOutcome: cached.stats?.summaryCacheOutcome,
        summaryBuildMs: cached.stats?.summaryBuildMs,
        summaryLeafParses: cached.stats?.summaryLeafParses,
        summaryRawSourceCount: cached.stats?.summaryRawSourceCount,
        summaryRetainedClusterCount: cached.stats?.summaryRetainedClusterCount,
        summaryCappedClusterCount: cached.stats?.summaryCappedClusterCount,
        chunkColumns: cached.stats?.chunkColumns,
        externalRegionParses: cached.stats?.externalRegionParses,
        externalRegionCacheHits: cached.stats?.externalRegionCacheHits,
        externalRegionMisses: cached.stats?.externalRegionMisses,
        externalRegionParseErrors: cached.stats?.externalRegionParseErrors,
        minWorldZ: cached.stats?.minWorldZ,
        maxWorldZ: cached.stats?.maxWorldZ,
      };
      if (!this.isCurrentEpoch(key, cached.globalEpoch, cached.keyEpoch)) {
        this.staleDrops++;
        return { status: "empty", metrics };
      }
      return {
        status: "ok",
        buf: variant.buf,
        etag: variant.etag,
        contentEncoding:
          contentEncoding === "identity" ? undefined : contentEncoding,
        metrics,
      };
    }

    const globalEpoch = this.globalEpoch;
    const keyEpoch = this.keyEpochs.get(key) ?? 0;
    const versionedKey = `${key}@${globalEpoch}:${keyEpoch}`;
    const existing = this.inFlight.get(key);
    const operation =
      existing &&
      existing.versionedKey === versionedKey &&
      !existing.queuedCancelled
        ? existing
        : this.createInFlightOperation(
            key,
            lod,
            regionX,
            regionY,
            globalEpoch,
            keyEpoch,
            versionedKey,
            includeHaloEmitters,
          );
    if (operation === existing) {
      operation.consumers++;
      this.sharedPipelineConsumers++;
      if (operation.orphaned) this.orphanRejoins++;
    }
    operation.orphaned = false;

    let outcome: PipelineResult;
    try {
      outcome = await this.waitForConsumer(operation.promise, signal);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        this.consumerCancellations++;
      }
      throw error;
    } finally {
      operation.consumers--;
      if (operation.consumers === 0 && !operation.settled) {
        if (this.pool.cancelQueued(operation.jobId)) {
          operation.queuedCancelled = true;
        } else {
          if (!operation.orphaned) this.runningOrphans++;
          operation.orphaned = true;
        }
      }
      this.releaseInFlight(key, operation);
    }
    const { result, queueMs, runMs } = outcome.instrumented ?? {};
    const safeQueueMs =
      typeof queueMs === "number" && Number.isFinite(queueMs) ? queueMs : 0;
    const safeRunMs =
      typeof runMs === "number" && Number.isFinite(runMs) ? runMs : 0;
    this.workerRequests++;
    this.recordMetric(this.queueMetric, safeQueueMs);
    this.recordMetric(this.runMetric, safeRunMs);
    const totalMs = performance.now() - startedAt;
    this.recordMetric(this.totalMetric, totalMs);
    const metrics: VoxelRequestMetrics = {
      source: "worker",
      cacheOutcome: result?.stats
        ? result.stats.cacheTier === "worker"
          ? "miss"
          : "hit"
        : "unknown",
      queueMs: safeQueueMs,
      runMs: safeRunMs,
      totalMs,
      queueDepth: this.pool.getQueueDepth(),
      runningJobs: this.pool.getRunningCount(),
      inFlightJobs: this.inFlight.size,
      byteLength: result?.status === "ok" ? result.buffer.byteLength : 0,
      cacheTier: result?.stats?.cacheTier,
      quadCount: result?.stats?.quadCount,
      greedyCubeQuads: result?.stats?.greedyCubeQuads,
      modelQuads: result?.stats?.modelQuads,
      droppedModelQuads: result?.stats?.droppedModelQuads,
      modelQuadBudget: result?.stats?.modelQuadBudget,
      transparentQuads: result?.stats?.transparentQuads,
      rawPayloadBytes: result?.stats?.rawPayloadBytes,
      greedyRecordBytes: result?.stats?.greedyRecordBytes,
      modelRecordBytes: result?.stats?.modelRecordBytes,
      emitterRecords: result?.stats?.emitterRecords,
      ownEmitterRecords: result?.stats?.ownEmitterRecords,
      haloEmitterRecords: result?.stats?.haloEmitterRecords,
      aggregatedEmitterRecords: result?.stats?.aggregatedEmitterRecords,
      haloMs:
        result?.stats?.cacheTier === "worker"
          ? result.stats?.haloMs
          : undefined,
      cachedHaloMs:
        result?.stats?.cacheTier === "disk" ? result.stats.haloMs : undefined,
      emitterRecordBytes: result?.stats?.emitterRecordBytes,
      emitterMetadataBytes: result?.stats?.emitterMetadataBytes,
      emitterPowerMin: result?.stats?.emitterPowerMin,
      emitterPowerMax: result?.stats?.emitterPowerMax,
      emitterRadiusMin: result?.stats?.emitterRadiusMin,
      emitterRadiusMax: result?.stats?.emitterRadiusMax,
      summaryCacheOutcome: result?.stats?.summaryCacheOutcome,
      summaryBuildMs: result?.stats?.summaryBuildMs,
      summaryLeafParses: result?.stats?.summaryLeafParses,
      summaryRawSourceCount: result?.stats?.summaryRawSourceCount,
      summaryRetainedClusterCount: result?.stats?.summaryRetainedClusterCount,
      summaryCappedClusterCount: result?.stats?.summaryCappedClusterCount,
      chunkColumns: result?.stats?.chunkColumns,
      regionsParsed: result?.stats?.regionsParsed,
      chunksMeshed: result?.stats?.chunksMeshed,
      visitedAirCells: result?.stats?.visitedAirCells,
      facesBeforeMerge: result?.stats?.facesBeforeMerge,
      externalRegionParses: result?.stats?.externalRegionParses,
      externalRegionCacheHits: result?.stats?.externalRegionCacheHits,
      externalRegionMisses: result?.stats?.externalRegionMisses,
      externalRegionParseErrors: result?.stats?.externalRegionParseErrors,
      minWorldZ: result?.stats?.minWorldZ,
      maxWorldZ: result?.stats?.maxWorldZ,
    };

    if (!result || result.status === "empty") {
      this.emptyResponses++;
      return { status: "empty", metrics };
    }
    if (result.status === "error") {
      this.errors++;
      throw new Error(result.error);
    }

    const cachedMesh = outcome.cachedMesh;
    if (!cachedMesh) return { status: "empty", metrics };
    const variant = await this.waitForConsumer(
      this.getVariant(cachedMesh, contentEncoding),
      signal,
    );
    if (
      operation.invalidated ||
      !this.isCurrentEpoch(key, cachedMesh.globalEpoch, cachedMesh.keyEpoch)
    ) {
      this.staleDrops++;
      return { status: "empty", metrics };
    }
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
      metrics: cached.stats
        ? {
            cacheTier: cached.stats.cacheTier,
            quadCount: cached.stats.quadCount,
            greedyCubeQuads: cached.stats.greedyCubeQuads,
            modelQuads: cached.stats.modelQuads,
            droppedModelQuads: cached.stats.droppedModelQuads,
            modelQuadBudget: cached.stats.modelQuadBudget,
            transparentQuads: cached.stats.transparentQuads,
            rawPayloadBytes: cached.stats.rawPayloadBytes,
            greedyRecordBytes: cached.stats.greedyRecordBytes,
            modelRecordBytes: cached.stats.modelRecordBytes,
            emitterRecords: cached.stats.emitterRecords,
            ownEmitterRecords: cached.stats.ownEmitterRecords,
            haloEmitterRecords: cached.stats.haloEmitterRecords,
            aggregatedEmitterRecords: cached.stats.aggregatedEmitterRecords,
            emitterRecordBytes: cached.stats.emitterRecordBytes,
            emitterMetadataBytes: cached.stats.emitterMetadataBytes,
            emitterPowerMin: cached.stats.emitterPowerMin,
            emitterPowerMax: cached.stats.emitterPowerMax,
            emitterRadiusMin: cached.stats.emitterRadiusMin,
            emitterRadiusMax: cached.stats.emitterRadiusMax,
            summaryCacheOutcome: cached.stats.summaryCacheOutcome,
            summaryBuildMs: cached.stats.summaryBuildMs,
            summaryLeafParses: cached.stats.summaryLeafParses,
            summaryRawSourceCount: cached.stats.summaryRawSourceCount,
            summaryRetainedClusterCount:
              cached.stats.summaryRetainedClusterCount,
            summaryCappedClusterCount: cached.stats.summaryCappedClusterCount,
            externalRegionParses: cached.stats.externalRegionParses,
            externalRegionCacheHits: cached.stats.externalRegionCacheHits,
            externalRegionMisses: cached.stats.externalRegionMisses,
            externalRegionParseErrors: cached.stats.externalRegionParseErrors,
          }
        : undefined,
      variants,
    };
  }

  private createInFlightOperation(
    key: string,
    lod: number,
    regionX: number,
    regionY: number,
    globalEpoch: number,
    keyEpoch: number,
    versionedKey: string,
    includeHaloEmitters = true,
  ): InFlightJob {
    const jobId = this.nextJobId++;
    const operation: InFlightJob = {
      versionedKey,
      jobId,
      consumers: 1,
      queuedCancelled: false,
      orphaned: false,
      invalidated: false,
      settled: false,
      promise: Promise.resolve({}),
    };
    operation.promise = this.runPipeline(
      operation,
      key,
      lod,
      regionX,
      regionY,
      globalEpoch,
      keyEpoch,
      includeHaloEmitters,
    ).finally(() => {
      operation.settled = true;
      this.releaseInFlight(key, operation);
    });
    this.inFlight.set(key, operation);
    return operation;
  }

  private async runPipeline(
    operation: InFlightJob,
    key: string,
    lod: number,
    regionX: number,
    regionY: number,
    globalEpoch: number,
    keyEpoch: number,
    includeHaloEmitters: boolean,
  ): Promise<PipelineResult> {
    const emitterSummary =
      lod > 1 ? await this.getEmitterSummary(lod, regionX, regionY) : undefined;
    if (operation.invalidated || operation.consumers === 0) return {};

    let instrumented: InstrumentedPoolResult;
    try {
      instrumented = await this.pool.run({
        id: operation.jobId,
        key,
        lod,
        regionX,
        regionY,
        globalEpoch,
        keyEpoch,
        includeHaloEmitters,
        emitterSummary: emitterSummary?.node,
        emitterSummaryMetrics: emitterSummary?.metrics,
      });
    } catch (error) {
      if (
        error instanceof VoxelQueuedJobCancelledError &&
        (operation.invalidated || operation.consumers === 0)
      ) {
        return {};
      }
      throw error;
    }

    const { result } = instrumented;
    if (operation.orphaned && operation.consumers === 0) {
      this.orphanCompletions++;
    }
    if (
      result.status !== "ok" ||
      operation.invalidated ||
      operation.orphaned ||
      operation.consumers === 0 ||
      !this.isCurrentEpoch(key, result.globalEpoch, result.keyEpoch)
    ) {
      if (
        result.status === "ok" &&
        (operation.invalidated ||
          !this.isCurrentEpoch(key, result.globalEpoch, result.keyEpoch))
      ) {
        this.staleDrops++;
      }
      return { instrumented };
    }

    const sourceSignature = await this.computeSourceSignature({
      savePath: this.savePath,
      blockShapeSignature: this.blockShapeSignature,
      blockColorSignature: this.blockColorSignature,
      lod,
      regionX,
      regionY,
      emitterSummarySignature: emitterSummary?.node.signature,
    });
    if (
      !sourceSignature ||
      operation.invalidated ||
      operation.orphaned ||
      operation.consumers === 0 ||
      !this.isCurrentEpoch(key, result.globalEpoch, result.keyEpoch)
    ) {
      if (!sourceSignature) this.emptyResponses++;
      else this.staleDrops++;
      return { instrumented };
    }

    const responseBuffer = Buffer.from(result.buffer);
    const variants = new Map<VoxelContentEncoding, CachedVoxelVariant>();
    variants.set("identity", {
      buf: responseBuffer,
      etag: this.buildVariantEtag(key, sourceSignature, "identity"),
    });
    const cachedMesh: CachedVoxelMesh = {
      key,
      globalEpoch,
      keyEpoch,
      buf: responseBuffer,
      sourceSignature,
      cacheTier: result.stats?.cacheTier ?? "worker",
      stats: result.stats,
      variants,
      variantJobs: new Map(),
    };
    this.cache.set(key, cachedMesh);
    return { instrumented, cachedMesh };
  }

  private invalidateInFlight(key: string): void {
    const operation = this.inFlight.get(key);
    if (!operation) return;
    operation.invalidated = true;
    if (this.pool.cancelQueued(operation.jobId))
      operation.queuedCancelled = true;
  }

  private releaseInFlight(key: string, operation: InFlightJob): void {
    if (!operation.settled || operation.consumers > 0) return;
    if (this.inFlight.get(key) === operation) this.inFlight.delete(key);
  }

  private waitForConsumer<T>(
    promise: Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(this.createAbortError());
    return new Promise<T>((resolve, reject) => {
      const abort = () => reject(this.createAbortError());
      signal.addEventListener("abort", abort, { once: true });
      promise.then(resolve, reject).finally(() => {
        signal.removeEventListener("abort", abort);
      });
    });
  }

  private createAbortError(): Error {
    const error = new Error("Voxel request aborted");
    error.name = "AbortError";
    return error;
  }

  private async getEmitterSummary(
    lod: number,
    regionX: number,
    regionY: number,
  ): Promise<EmitterSummaryResult> {
    return this.getCoarseEmitterSummary(lod, regionX, regionY);
  }

  private async getCoarseEmitterSummary(
    lod: number,
    regionX: number,
    regionY: number,
  ): Promise<EmitterSummaryResult> {
    const span = 128 * lod;
    const results = await Promise.all(
      [-1, 0, 1].flatMap((dx) =>
        [-1, 0, 1].map((dy) =>
          this.emitterSummaries.getNode(
            lod,
            regionX + dx * span,
            regionY + dy * span,
          ),
        ),
      ),
    );
    const clusters: EmitterSummaryCluster[] = [];
    for (const result of results) {
      for (const cluster of result.node.clusters) {
        const radius = getEmitterSummaryRadius(cluster);
        const dx =
          cluster.centroidX < regionX
            ? regionX - cluster.centroidX
            : Math.max(0, cluster.centroidX - (regionX + span));
        const dy =
          cluster.centroidY < regionY
            ? regionY - cluster.centroidY
            : Math.max(0, cluster.centroidY - (regionY + span));
        if (dx * dx + dy * dy < radius * radius) clusters.push(cluster);
      }
    }
    const signature = createHash("sha1")
      .update("coarse-halo-summary-v1")
      .update(results.map((result) => result.node.signature).join("|"))
      .digest("hex");
    const own = results[4];
    if (!own) throw new Error("Missing owning emitter summary");
    return {
      node: {
        ...own.node,
        sourceSignature: signature,
        signature,
        rawSourceCount: results.reduce(
          (sum, result) => sum + result.node.rawSourceCount,
          0,
        ),
        cappedClusterCount: results.reduce(
          (sum, result) => sum + result.node.cappedClusterCount,
          0,
        ),
        clusters,
      },
      metrics: {
        cacheOutcome: results.some(
          (result) => result.metrics.cacheOutcome === "built",
        )
          ? "built"
          : results.some((result) => result.metrics.cacheOutcome === "disk")
            ? "disk"
            : "memory",
        buildMs: results.reduce(
          (sum, result) => sum + result.metrics.buildMs,
          0,
        ),
        leafParses: results.reduce(
          (sum, result) => sum + result.metrics.leafParses,
          0,
        ),
        rawSourceCount: results.reduce(
          (sum, result) => sum + result.metrics.rawSourceCount,
          0,
        ),
        retainedClusterCount: clusters.length,
        cappedClusterCount: results.reduce(
          (sum, result) => sum + result.metrics.cappedClusterCount,
          0,
        ),
      },
    };
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
        if (
          this.isCurrentEpoch(cached.key, cached.globalEpoch, cached.keyEpoch)
        ) {
          this.cache.set(cached.key, cached);
        }
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

  private getRetainedBufferBytes(mesh: CachedVoxelMesh): number {
    const buffers = new Set<ArrayBufferLike>();
    for (const variant of mesh.variants.values())
      buffers.add(variant.buf.buffer);
    return [...buffers].reduce((sum, buffer) => sum + buffer.byteLength, 0);
  }

  private getCacheBufferBytes(encoding: VoxelContentEncoding): number {
    let bytes = 0;
    for (const mesh of this.cache.values()) {
      const variant = mesh.variants.get(encoding);
      if (variant) bytes += variant.buf.buffer.byteLength;
    }
    return bytes;
  }
}
