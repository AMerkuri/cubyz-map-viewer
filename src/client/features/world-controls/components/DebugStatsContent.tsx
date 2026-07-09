import { uiTheme } from "../../../lib/ui-theme.js";
import type { ChunkStats } from "../../../lib/world-view-debug.js";
import {
  formatMemoryBytes,
  formatNullableBytes,
  formatNullableCount,
  formatNullableMs,
} from "../../../utils/world-view-formatters.js";

function StatsSectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 4,
        color: uiTheme.accent.text,
        fontWeight: 400,
      }}
    >
      {children}
    </div>
  );
}

export function DebugStatsContent({ chunkStats }: { chunkStats: ChunkStats }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div>Focus LOD: {chunkStats.focusLod}</div>
      <div>FPS: {chunkStats.fps}</div>
      <div>Loading chunks: {chunkStats.loading}</div>
      <div>Loaded chunks: {chunkStats.loaded}</div>

      <StatsSectionTitle>Loading breakdown</StatsSectionTitle>
      <div>Terrain loading: {chunkStats.loadingBreakdown.terrain}</div>
      <div>Voxel loading: {chunkStats.loadingBreakdown.voxels}</div>
      <div>Fetch queue: {chunkStats.loadingBreakdown.fetchQueue}</div>
      <div>Mesh queue: {chunkStats.loadingBreakdown.meshQueue}</div>

      <StatsSectionTitle>Voxel health</StatsSectionTitle>
      <div>Missing regions: {chunkStats.voxelHealth.missing}</div>
      <div>Failed regions: {chunkStats.voxelHealth.failed}</div>

      <StatsSectionTitle>Block lights</StatsSectionTitle>
      <div>Decoded emitters: {chunkStats.blockLight.decodedEmitters}</div>
      <div>Active accent emitters: {chunkStats.blockLight.activeEmitters}</div>
      <div>Accent budget: {chunkStats.blockLight.budget}</div>
      <div>Glow budget: {chunkStats.blockLight.glowBudget}</div>
      <div>Point-light budget: {chunkStats.blockLight.pointLightBudget}</div>
      <div>
        Accents degraded: {chunkStats.blockLight.degraded ? "yes" : "no"}
      </div>

      <StatsSectionTitle>Loaded by LOD</StatsSectionTitle>
      <div>
        {([1, 2, 4, 8, 16, 32] as const)
          .map((lod) => `L${lod}:${chunkStats.loadedByLod[lod] ?? 0}`)
          .join("  ")}
      </div>

      <StatsSectionTitle>Estimated Memory</StatsSectionTitle>
      <div>Total: {formatMemoryBytes(chunkStats.memoryBytes)}</div>
      <div>
        Terrain: {formatMemoryBytes(chunkStats.memoryBreakdown.terrain)}
      </div>
      <div>Voxels: {formatMemoryBytes(chunkStats.memoryBreakdown.voxels)}</div>
      <div>
        Voxel geometry:{" "}
        {formatMemoryBytes(chunkStats.memoryBreakdown.voxelGeometry)}
      </div>
      <div>
        Voxel metadata:{" "}
        {formatMemoryBytes(chunkStats.memoryBreakdown.voxelMetadata)}
      </div>
      <div>
        Terrain warm cache:{" "}
        {formatMemoryBytes(chunkStats.memoryBreakdown.cachedTerrain)} (
        {chunkStats.warmCacheCount.terrain})
      </div>
      <div>
        Voxel warm cache:{" "}
        {formatMemoryBytes(chunkStats.memoryBreakdown.cachedVoxels)} (
        {chunkStats.warmCacheCount.voxels})
      </div>
      <div>Queued: {formatMemoryBytes(chunkStats.memoryBreakdown.queued)}</div>
      <div>
        Queued voxel output:{" "}
        {formatMemoryBytes(chunkStats.memoryBreakdown.queuedVoxelOutput)}
      </div>
      <div>
        JS heap:{" "}
        {chunkStats.jsHeapBytes === null
          ? "n/a"
          : formatMemoryBytes(chunkStats.jsHeapBytes)}
      </div>

      <StatsSectionTitle>Memory by LOD</StatsSectionTitle>
      <div>
        {([1, 2, 4, 8, 16, 32] as const)
          .map(
            (lod) =>
              `L${lod}:${formatMemoryBytes(chunkStats.memoryByLod[lod] ?? 0)}`,
          )
          .join("  ")}
      </div>

      <StatsSectionTitle>Voxel Benchmark</StatsSectionTitle>
      <div>
        Diag matrix: halo{" "}
        {chunkStats.voxelBenchmark.haloEmittersEnabled ? "on" : "off"} /
        emissive{" "}
        {chunkStats.voxelBenchmark.emissiveAttributesEnabled ? "on" : "off"}
      </div>
      <div>Samples: {chunkStats.voxelBenchmark.samples}</div>
      <div>
        Cache mix: hit {chunkStats.voxelBenchmark.cacheHitSamples} / miss{" "}
        {chunkStats.voxelBenchmark.cacheMissSamples} / unknown{" "}
        {chunkStats.voxelBenchmark.cacheUnknownSamples}
      </div>
      <div>Encoding: {chunkStats.voxelBenchmark.contentEncoding ?? "n/a"}</div>
      <div>Avg fetch: {chunkStats.voxelBenchmark.avgFetchMs.toFixed(1)} ms</div>
      <div>
        Avg decode: {chunkStats.voxelBenchmark.avgDecodeMs.toFixed(1)} ms
      </div>
      <div>Avg total: {chunkStats.voxelBenchmark.avgTotalMs.toFixed(1)} ms</div>
      <div>
        Avg transfer:{" "}
        {formatNullableBytes(chunkStats.voxelBenchmark.avgTransferBytes)}
      </div>
      <div>
        Avg encoded:{" "}
        {formatNullableBytes(chunkStats.voxelBenchmark.avgEncodedBodyBytes)}
      </div>
      <div>
        Avg decoded:{" "}
        {formatNullableBytes(chunkStats.voxelBenchmark.avgDecodedBodyBytes)}
      </div>
      <div>
        Avg worker input:{" "}
        {formatNullableBytes(chunkStats.voxelBenchmark.avgRawBufferBytes)}
      </div>
      <div>
        Avg worker output:{" "}
        {formatNullableBytes(chunkStats.voxelBenchmark.avgWorkerOutputBytes)}
      </div>
      <div>
        Avg emissive bytes:{" "}
        {formatNullableBytes(chunkStats.voxelBenchmark.avgEmissiveBytes)}
      </div>
      <div>
        Avg emissive grid:{" "}
        {formatNullableMs(chunkStats.voxelBenchmark.avgEmissiveGridBuildMs)}
      </div>
      <div>
        Avg emissive bake:{" "}
        {formatNullableMs(chunkStats.voxelBenchmark.avgEmissiveBakeMs)}
      </div>
      <div>
        Avg emissive quads: eval{" "}
        {formatNullableCount(
          chunkStats.voxelBenchmark.avgEmissiveQuadsEvaluated,
        )}{" "}
        / culled{" "}
        {formatNullableCount(chunkStats.voxelBenchmark.avgEmissiveQuadsCulled)}
      </div>
      <div>
        Avg server run:{" "}
        {chunkStats.voxelBenchmark.avgServerRunMs === null
          ? "n/a"
          : `${chunkStats.voxelBenchmark.avgServerRunMs.toFixed(1)} ms`}
      </div>
      <div>
        Avg server halo:{" "}
        {chunkStats.voxelBenchmark.avgServerHaloMs === null
          ? "n/a"
          : `${chunkStats.voxelBenchmark.avgServerHaloMs.toFixed(1)} ms`}
        {" (current generation only; cached halo timing is excluded)"}
      </div>
    </div>
  );
}
