import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { CHUNK_SIZE, REGION_SIZE } from "../parsers/region.js";
import type { BlockColorTable } from "./block-color-table.js";
import type { BlockShapeTable } from "./block-shape-table.js";
import { WeightedLRUCache } from "./cache.js";
import {
  EMITTER_SUMMARY_CLUSTER_EDGE_BY_LOD,
  EMITTER_SUMMARY_FORMAT_VERSION,
  EMITTER_SUMMARY_LIMIT_BY_LOD,
  EMITTER_SUMMARY_SIGNATURE,
  type EmitterSummaryBuildMetrics,
  type EmitterSummaryCluster,
  type EmitterSummaryLod,
  type EmitterSummaryNode,
  type EmitterSummaryResult,
  isEmitterSummaryLod,
} from "./voxel-emitter-aggregation.js";
import { generateVoxelMesh } from "./voxel-generator.js";

const REGION_CELLS = CHUNK_SIZE * REGION_SIZE;
const PROJECT_VOXEL_CACHE_DIR = resolve(
  process.env.VOXEL_CACHE_DIR ??
    join(process.cwd(), "dist", "server", "cache", "voxels"),
);
interface BuiltClusters {
  clusters: EmitterSummaryCluster[];
  cappedClusterCount: number;
}

export interface VoxelEmitterSummaryServiceOptions {
  leafBuildLimit?: number;
  memoryCacheSize?: number;
  memoryCacheByteLimit?: number;
}

export interface VoxelEmitterSummaryCacheMetrics {
  entries: number;
  estimatedBytes: number;
  retainedClusters: number;
  evictions: number;
  oversizedSkips: number;
  activeWork: number;
}

interface SummaryWork {
  valid: boolean;
  promise: Promise<EmitterSummaryResult>;
}

export class VoxelEmitterSummaryService {
  private readonly memory: WeightedLRUCache<string, EmitterSummaryNode>;
  private readonly inFlight = new Map<string, SummaryWork>();
  private readonly leafBuildQueue: Array<() => void> = [];
  private readonly leafBuildLimit: number;
  private leafBuildActive = 0;
  private activeWork = 0;
  private readonly cacheRoot: string;

  constructor(
    private readonly savePath: string,
    private readonly blockColors: BlockColorTable,
    private readonly blockShapes: BlockShapeTable,
    memoryCacheSize = 512,
    options: VoxelEmitterSummaryServiceOptions = {},
  ) {
    const saveNamespace = createHash("sha1")
      .update(savePath)
      .digest("hex")
      .slice(0, 16);
    this.cacheRoot = join(
      PROJECT_VOXEL_CACHE_DIR,
      saveNamespace,
      "emitter-summaries",
      String(EMITTER_SUMMARY_FORMAT_VERSION),
    );
    this.memory = new WeightedLRUCache(
      options.memoryCacheSize ?? memoryCacheSize,
      options.memoryCacheByteLimit ?? 64 * 1024 * 1024,
      estimatedNodeBytes,
    );
    this.leafBuildLimit = Math.max(1, options.leafBuildLimit ?? 1);
  }

  getNode(
    lod: number,
    regionX: number,
    regionY: number,
  ): Promise<EmitterSummaryResult> {
    if (!isEmitterSummaryLod(lod)) {
      return Promise.reject(new Error(`Invalid emitter summary LOD: ${lod}`));
    }
    const span = REGION_CELLS * lod;
    if (regionX % span !== 0 || regionY % span !== 0) {
      return Promise.reject(new Error("Unaligned emitter summary coordinates"));
    }

    const key = nodeKey(lod, regionX, regionY);
    const existing = this.inFlight.get(key);
    if (existing) return existing.promise;

    const work = {} as SummaryWork;
    work.valid = true;
    this.activeWork++;
    work.promise = this.loadOrBuildNode(lod, regionX, regionY, work).finally(
      () => {
        this.activeWork--;
        if (this.inFlight.get(key) === work) this.inFlight.delete(key);
      },
    );
    this.inFlight.set(key, work);
    return work.promise;
  }

  clear(): void {
    this.memory.clear();
    for (const work of this.inFlight.values()) work.valid = false;
    this.inFlight.clear();
  }

  invalidate(lod: EmitterSummaryLod, regionX: number, regionY: number): void {
    const key = nodeKey(lod, regionX, regionY);
    this.memory.delete(key);
    const work = this.inFlight.get(key);
    if (work) work.valid = false;
    this.inFlight.delete(key);
    void rm(this.nodePath(lod, regionX, regionY), { force: true });
  }

  getMetricsSnapshot(): VoxelEmitterSummaryCacheMetrics {
    let retainedClusters = 0;
    for (const node of this.memory.values()) {
      retainedClusters += node.clusters.length;
    }
    return {
      entries: this.memory.size,
      estimatedBytes: this.memory.weight,
      retainedClusters,
      evictions: this.memory.evictions,
      oversizedSkips: this.memory.oversizedSkips,
      activeWork: this.activeWork,
    };
  }

  private async loadOrBuildNode(
    lod: EmitterSummaryLod,
    regionX: number,
    regionY: number,
    work: SummaryWork,
  ): Promise<EmitterSummaryResult> {
    const startedAt = performance.now();
    if (lod === 1) {
      const sourceSignature = await this.buildLeafSourceSignature(
        regionX,
        regionY,
      );
      const cached = await this.readCachedNode(
        lod,
        regionX,
        regionY,
        sourceSignature,
        work,
      );
      if (cached) {
        return resultForCachedNode(cached, performance.now() - startedAt);
      }
      const { clusters, rawSourceCount, cappedClusterCount, leafParses } =
        await this.withLeafBuildSlot(() => this.buildLeaf(regionX, regionY));
      const node = this.createNode(
        lod,
        regionX,
        regionY,
        sourceSignature,
        rawSourceCount,
        cappedClusterCount,
        clusters,
        work,
      );
      await this.persistNode(node);
      await this.removeStaleNode(work, node);
      return {
        node,
        metrics: {
          cacheOutcome: "built",
          buildMs: performance.now() - startedAt,
          leafParses,
          rawSourceCount,
          retainedClusterCount: clusters.length,
          cappedClusterCount,
        },
      };
    }

    const childLod = (lod / 2) as EmitterSummaryLod;
    const childSpan = REGION_CELLS * childLod;
    const children = await Promise.all([
      this.getNode(childLod, regionX, regionY),
      this.getNode(childLod, regionX + childSpan, regionY),
      this.getNode(childLod, regionX, regionY + childSpan),
      this.getNode(childLod, regionX + childSpan, regionY + childSpan),
    ]);
    const sourceSignature = createHash("sha1")
      .update(children.map(({ node }) => node.signature).join("|"))
      .digest("hex");
    const cached = await this.readCachedNode(
      lod,
      regionX,
      regionY,
      sourceSignature,
      work,
    );
    const childMetrics = mergeMetrics(children.map(({ metrics }) => metrics));
    if (cached) {
      return {
        node: cached,
        metrics: {
          ...childMetrics,
          cacheOutcome: "disk",
          buildMs: performance.now() - startedAt,
          retainedClusterCount: cached.clusters.length,
          cappedClusterCount: cached.cappedClusterCount,
        },
      };
    }

    const rawSourceCount = children.reduce(
      (sum, child) => sum + child.node.rawSourceCount,
      0,
    );
    const inheritedCapped = children.reduce(
      (sum, child) => sum + child.node.cappedClusterCount,
      0,
    );
    const built = clusterForLod(
      children.flatMap(({ node }) => node.clusters),
      lod,
    );
    const node = this.createNode(
      lod,
      regionX,
      regionY,
      sourceSignature,
      rawSourceCount,
      inheritedCapped + built.cappedClusterCount,
      built.clusters,
      work,
    );
    await this.persistNode(node);
    await this.removeStaleNode(work, node);
    return {
      node,
      metrics: {
        ...childMetrics,
        cacheOutcome: "built",
        buildMs: performance.now() - startedAt,
        rawSourceCount,
        retainedClusterCount: node.clusters.length,
        cappedClusterCount: node.cappedClusterCount,
      },
    };
  }

  private async withLeafBuildSlot<T>(build: () => Promise<T>): Promise<T> {
    if (this.leafBuildActive >= this.leafBuildLimit) {
      await new Promise<void>((resolve) => this.leafBuildQueue.push(resolve));
    }
    this.leafBuildActive++;
    try {
      return await build();
    } finally {
      this.leafBuildActive--;
      const next = this.leafBuildQueue.shift();
      if (next) next();
    }
  }

  protected async buildLeaf(
    regionX: number,
    regionY: number,
  ): Promise<{
    clusters: EmitterSummaryCluster[];
    rawSourceCount: number;
    cappedClusterCount: number;
    leafParses: number;
  }> {
    const generated = await generateVoxelMesh(
      this.savePath,
      this.blockColors,
      this.blockShapes,
      1,
      regionX,
      regionY,
      { includeHaloEmitters: false, returnRepresentedSources: true },
    );
    const clusters: EmitterSummaryCluster[] = [];
    for (const source of generated.representedSources ?? []) {
      const scale = Math.max(source.r, source.g, source.b);
      const powerR = source.r / scale;
      const powerG = source.g / scale;
      const powerB = source.b / scale;
      const weight = luminance(powerR, powerG, powerB);
      clusters.push({
        powerR,
        powerG,
        powerB,
        centroidX: source.x + 0.5,
        centroidY: source.y + 0.5,
        centroidZ: source.z + 0.5,
        centroidWeight: weight,
        sourceCount: 1,
        openFaces: source.openFaces,
        minX: source.x,
        minY: source.y,
        minZ: source.z,
        maxX: source.x + 1,
        maxY: source.y + 1,
        maxZ: source.z + 1,
        representedLods: source.representedLods,
      });
    }

    const rawSourceCount = clusters.length;
    const built = clusterForLod(clusters, 1);
    return {
      ...built,
      rawSourceCount,
      leafParses: generated.stats?.regionsParsed ?? 0,
    };
  }

  protected async buildLeafSourceSignature(
    regionX: number,
    regionY: number,
  ): Promise<string> {
    const hash = createHash("sha1");
    hash.update(`${EMITTER_SUMMARY_SIGNATURE}|${this.blockColors.signature}|`);
    hash.update(`${this.blockShapes.signature}|${regionX}|${regionY}|`);
    for (const [columnX, columnY] of [
      [regionX, regionY],
      [regionX - REGION_CELLS, regionY],
      [regionX + REGION_CELLS, regionY],
      [regionX, regionY - REGION_CELLS],
      [regionX, regionY + REGION_CELLS],
    ]) {
      hash.update(`${columnX}/${columnY}:`);
      const dir = this.columnPath(columnX, columnY);
      if (!existsSync(dir)) {
        hash.update("missing|");
        continue;
      }
      for (const worldZ of await listRegionZs(dir)) {
        const fileStats = await stat(join(dir, `${worldZ}.region`));
        hash.update(
          `${worldZ}:${Math.trunc(fileStats.mtimeMs)}:${fileStats.size}|`,
        );
      }
    }
    return hash.digest("hex");
  }

  private createNode(
    lod: EmitterSummaryLod,
    regionX: number,
    regionY: number,
    sourceSignature: string,
    rawSourceCount: number,
    cappedClusterCount: number,
    clusters: EmitterSummaryCluster[],
    work: SummaryWork,
  ): EmitterSummaryNode {
    const signature = createHash("sha1")
      .update(`${EMITTER_SUMMARY_SIGNATURE}|${lod}|${regionX}|${regionY}|`)
      .update(`${sourceSignature}|${rawSourceCount}|${cappedClusterCount}|`)
      .update(JSON.stringify(clusters))
      .digest("hex");
    const node: EmitterSummaryNode = {
      formatVersion: EMITTER_SUMMARY_FORMAT_VERSION,
      lod,
      regionX,
      regionY,
      sourceSignature,
      signature,
      rawSourceCount,
      cappedClusterCount,
      clusters,
    };
    if (work.valid) this.memory.set(nodeKey(lod, regionX, regionY), node);
    return node;
  }

  private async readCachedNode(
    lod: EmitterSummaryLod,
    regionX: number,
    regionY: number,
    sourceSignature: string,
    work: SummaryWork,
  ): Promise<EmitterSummaryNode | null> {
    const key = nodeKey(lod, regionX, regionY);
    const memory = this.memory.get(key);
    if (memory?.sourceSignature === sourceSignature) return memory;
    try {
      const parsed = JSON.parse(
        await readFile(this.nodePath(lod, regionX, regionY), "utf8"),
      ) as unknown;
      if (!isValidNode(parsed, lod, regionX, regionY, sourceSignature)) {
        return null;
      }
      if (work.valid) this.memory.set(key, parsed);
      return parsed;
    } catch {
      return null;
    }
  }

  protected async persistNode(node: EmitterSummaryNode): Promise<void> {
    const path = this.nodePath(node.lod, node.regionX, node.regionY);
    await mkdir(join(this.cacheRoot, String(node.lod), String(node.regionX)), {
      recursive: true,
    });
    const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(node));
    try {
      await rename(temporaryPath, path);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }

  private async removeStaleNode(
    work: SummaryWork,
    node: EmitterSummaryNode,
  ): Promise<void> {
    if (work.valid) return;
    this.memory.delete(nodeKey(node.lod, node.regionX, node.regionY));
    await rm(this.nodePath(node.lod, node.regionX, node.regionY), {
      force: true,
    });
  }

  private columnPath(regionX: number, regionY: number): string {
    return join(this.savePath, "chunks", "1", String(regionX), String(regionY));
  }

  private nodePath(
    lod: EmitterSummaryLod,
    regionX: number,
    regionY: number,
  ): string {
    return join(
      this.cacheRoot,
      String(lod),
      String(regionX),
      `${regionY}.json`,
    );
  }
}

function clusterForLod(
  source: EmitterSummaryCluster[],
  lod: EmitterSummaryLod,
): BuiltClusters {
  const edge = EMITTER_SUMMARY_CLUSTER_EDGE_BY_LOD[lod];
  const grouped = new Map<string, EmitterSummaryCluster>();
  for (const cluster of source) {
    const key = `${Math.floor(cluster.centroidX / edge)}/${Math.floor(cluster.centroidY / edge)}/${Math.floor(cluster.centroidZ / edge)}`;
    const existing = grouped.get(key);
    grouped.set(
      key,
      existing ? mergeClusters(existing, cluster) : { ...cluster },
    );
  }

  const ordered = [...grouped.values()].sort(compareClusters);
  const limit = EMITTER_SUMMARY_LIMIT_BY_LOD[lod];
  if (ordered.length <= limit) {
    return { clusters: ordered, cappedClusterCount: 0 };
  }

  const topmostByHorizontalCell = new Map<string, EmitterSummaryCluster>();
  for (const cluster of ordered) {
    const key = `${Math.floor(cluster.centroidX / edge)}/${Math.floor(cluster.centroidY / edge)}`;
    const current = topmostByHorizontalCell.get(key);
    if (
      !current ||
      cluster.centroidZ > current.centroidZ ||
      (cluster.centroidZ === current.centroidZ &&
        compareClusters(cluster, current) < 0)
    ) {
      topmostByHorizontalCell.set(key, cluster);
    }
  }

  const topmost = [...topmostByHorizontalCell.values()].sort(
    (left, right) =>
      left.centroidX - right.centroidX ||
      left.centroidY - right.centroidY ||
      compareClusters(left, right),
  );
  const retained = new Set<EmitterSummaryCluster>();
  const topmostLimit = Math.min(topmost.length, limit);
  for (let index = 0; index < topmostLimit; index++) {
    const sampled =
      topmost[Math.floor((index * topmost.length) / topmostLimit)];
    if (sampled) retained.add(sampled);
  }
  for (const cluster of ordered) {
    if (retained.size >= limit) break;
    retained.add(cluster);
  }
  const retainedClusters = [...retained];
  retainedClusters.sort(compareClusters);
  return {
    clusters: retainedClusters,
    cappedClusterCount: ordered.length - limit,
  };
}

function mergeClusters(
  left: EmitterSummaryCluster,
  right: EmitterSummaryCluster,
): EmitterSummaryCluster {
  const centroidWeight = left.centroidWeight + right.centroidWeight;
  const safeWeight = centroidWeight || 1;
  return {
    powerR: left.powerR + right.powerR,
    powerG: left.powerG + right.powerG,
    powerB: left.powerB + right.powerB,
    centroidX:
      (left.centroidX * left.centroidWeight +
        right.centroidX * right.centroidWeight) /
      safeWeight,
    centroidY:
      (left.centroidY * left.centroidWeight +
        right.centroidY * right.centroidWeight) /
      safeWeight,
    centroidZ:
      (left.centroidZ * left.centroidWeight +
        right.centroidZ * right.centroidWeight) /
      safeWeight,
    centroidWeight,
    sourceCount: left.sourceCount + right.sourceCount,
    openFaces: left.openFaces | right.openFaces,
    minX: Math.min(left.minX, right.minX),
    minY: Math.min(left.minY, right.minY),
    minZ: Math.min(left.minZ, right.minZ),
    maxX: Math.max(left.maxX, right.maxX),
    maxY: Math.max(left.maxY, right.maxY),
    maxZ: Math.max(left.maxZ, right.maxZ),
    representedLods: left.representedLods | right.representedLods,
  };
}

function compareClusters(
  left: EmitterSummaryCluster,
  right: EmitterSummaryCluster,
): number {
  return (
    clusterPower(right) - clusterPower(left) ||
    right.sourceCount - left.sourceCount ||
    clusterExtent(right) - clusterExtent(left) ||
    left.centroidX - right.centroidX ||
    left.centroidY - right.centroidY ||
    left.centroidZ - right.centroidZ ||
    left.powerR - right.powerR ||
    left.powerG - right.powerG ||
    left.powerB - right.powerB
  );
}

function clusterPower(cluster: EmitterSummaryCluster): number {
  return luminance(cluster.powerR, cluster.powerG, cluster.powerB);
}

function clusterExtent(cluster: EmitterSummaryCluster): number {
  return (
    (cluster.maxX - cluster.minX) ** 2 +
    (cluster.maxY - cluster.minY) ** 2 +
    (cluster.maxZ - cluster.minZ) ** 2
  );
}

function luminance(r: number, g: number, b: number): number {
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

async function listRegionZs(directory: string): Promise<number[]> {
  return (await readdir(directory))
    .filter((entry) => entry.endsWith(".region"))
    .map((entry) => Number.parseInt(entry.slice(0, -7), 10))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
}

function isValidNode(
  value: unknown,
  lod: EmitterSummaryLod,
  regionX: number,
  regionY: number,
  sourceSignature: string,
): value is EmitterSummaryNode {
  if (!value || typeof value !== "object") return false;
  const node = value as Partial<EmitterSummaryNode>;
  if (
    node.formatVersion !== EMITTER_SUMMARY_FORMAT_VERSION ||
    node.lod !== lod ||
    node.regionX !== regionX ||
    node.regionY !== regionY ||
    node.sourceSignature !== sourceSignature ||
    typeof node.signature !== "string" ||
    typeof node.rawSourceCount !== "number" ||
    typeof node.cappedClusterCount !== "number" ||
    !Array.isArray(node.clusters) ||
    node.clusters.length > EMITTER_SUMMARY_LIMIT_BY_LOD[lod]
  ) {
    return false;
  }
  return node.clusters.every(isValidCluster);
}

function isValidCluster(value: unknown): value is EmitterSummaryCluster {
  if (!value || typeof value !== "object") return false;
  const cluster = value as Record<string, unknown>;
  return [
    "powerR",
    "powerG",
    "powerB",
    "centroidX",
    "centroidY",
    "centroidZ",
    "centroidWeight",
    "sourceCount",
    "openFaces",
    "minX",
    "minY",
    "minZ",
    "maxX",
    "maxY",
    "maxZ",
    "representedLods",
  ].every(
    (key) => typeof cluster[key] === "number" && Number.isFinite(cluster[key]),
  );
}

function mergeMetrics(
  metrics: EmitterSummaryBuildMetrics[],
): EmitterSummaryBuildMetrics {
  return {
    cacheOutcome: metrics.some(({ cacheOutcome }) => cacheOutcome === "built")
      ? "built"
      : metrics.some(({ cacheOutcome }) => cacheOutcome === "disk")
        ? "disk"
        : "memory",
    buildMs: metrics.reduce((sum, metric) => sum + metric.buildMs, 0),
    leafParses: metrics.reduce((sum, metric) => sum + metric.leafParses, 0),
    rawSourceCount: metrics.reduce(
      (sum, metric) => sum + metric.rawSourceCount,
      0,
    ),
    retainedClusterCount: metrics.reduce(
      (sum, metric) => sum + metric.retainedClusterCount,
      0,
    ),
    cappedClusterCount: metrics.reduce(
      (sum, metric) => sum + metric.cappedClusterCount,
      0,
    ),
  };
}

function resultForCachedNode(
  node: EmitterSummaryNode,
  buildMs: number,
): EmitterSummaryResult {
  return {
    node,
    metrics: {
      cacheOutcome: "memory",
      buildMs,
      leafParses: 0,
      rawSourceCount: node.rawSourceCount,
      retainedClusterCount: node.clusters.length,
      cappedClusterCount: node.cappedClusterCount,
    },
  };
}

function nodeKey(
  lod: EmitterSummaryLod,
  regionX: number,
  regionY: number,
): string {
  return `${lod}/${regionX}/${regionY}`;
}

function estimatedNodeBytes(node: EmitterSummaryNode): number {
  return Buffer.byteLength(JSON.stringify(node), "utf8");
}
