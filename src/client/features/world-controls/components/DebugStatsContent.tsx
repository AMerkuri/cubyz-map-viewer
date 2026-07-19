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
  const formatTiming = (key: keyof typeof chunkStats.voxelPipeline.timings) => {
    const timing = chunkStats.voxelPipeline.timings[key];
    return timing.p50Ms === null
      ? "n/a"
      : `p50 ${timing.p50Ms.toFixed(1)} / p95 ${timing.p95Ms?.toFixed(1)} / max ${timing.maxMs?.toFixed(1)} ms (n=${timing.count})`;
  };
  const formatOutcomes = (outcomes: Record<string, number>) => {
    const entries = Object.entries(outcomes).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return entries.length === 0
      ? "none"
      : entries.map(([key, count]) => `${key} ${count}`).join(" / ");
  };
  const adaptive = chunkStats.voxelPipeline.adaptive;
  const formatAgeGroups = (groups: Record<string, number>) => {
    const entries = Object.entries(groups).sort(([left], [right]) =>
      left.localeCompare(right, undefined, { numeric: true }),
    );
    return entries.length === 0
      ? "none"
      : entries
          .map(([key, ageMs]) => `${key} ${ageMs.toFixed(0)} ms`)
          .join(" / ");
  };
  const formatObservation = (
    key: keyof typeof chunkStats.voxelPipeline.observations,
    format: (value: number) => string,
  ) => {
    const observation = chunkStats.voxelPipeline.observations[key];
    return observation.p50 === null
      ? "n/a"
      : `p50 ${format(observation.p50)} / p95 ${format(observation.p95 ?? 0)} / max ${format(observation.max ?? 0)} (n=${observation.count})`;
  };
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

      <StatsSectionTitle>Voxel pipeline</StatsSectionTitle>
      <div>
        Diagnostics load generation: {chunkStats.voxelPipeline.loadGeneration}
      </div>
      <div>
        Current compact-input queue:{" "}
        {chunkStats.voxelPipeline.compactInput.jobs} jobs /{" "}
        {formatMemoryBytes(chunkStats.voxelPipeline.compactInput.bytes)}
      </div>
      <div>
        Retained enhancement input:{" "}
        {chunkStats.voxelPipeline.retainedEnhancementInput.jobs} jobs /{" "}
        {formatMemoryBytes(
          chunkStats.voxelPipeline.retainedEnhancementInput.bytes,
        )}
        {" / "}
        {chunkStats.voxelPipeline.retainedEnhancementCapacity.jobs} jobs /{" "}
        {formatMemoryBytes(
          chunkStats.voxelPipeline.retainedEnhancementCapacity.bytes,
        )}{" "}
        capacity
      </div>
      <div>
        Expanded reservation / actual output:{" "}
        {formatMemoryBytes(
          chunkStats.voxelPipeline.reservedExpandedOutput.bytes,
        )}{" "}
        / {formatMemoryBytes(chunkStats.voxelPipeline.expandedOutput.bytes)}
        {" / "}
        {formatMemoryBytes(
          chunkStats.voxelPipeline.expandedOutputCapacity.bytes,
        )}{" "}
        capacity
      </div>
      <div>
        Current base scene-ready queue:{" "}
        {chunkStats.voxelPipeline.sceneBacklog.jobs} jobs /{" "}
        {formatMemoryBytes(chunkStats.voxelPipeline.sceneBacklog.bytes)}
      </div>
      <div>
        Adaptive profile / limiter: {adaptive.profile} /{" "}
        {adaptive.limiterReason}
      </div>
      <div>
        Adaptive target: {adaptive.diagnostics.initialTarget} initial /{" "}
        {adaptive.diagnostics.maximumTarget} maximum /{" "}
        {adaptive.diagnostics.scaleUpTransitions} up /{" "}
        {adaptive.diagnostics.scaleDownTransitions} down
      </div>
      <div>
        Adaptive pressure peak: {adaptive.diagnostics.peakExecutableBaseJobs}{" "}
        jobs / {adaptive.diagnostics.peakOldestExecutableBaseAgeMs.toFixed(0)}{" "}
        ms oldest
      </div>
      <div>
        Adaptive limiter history:{" "}
        {formatOutcomes(adaptive.diagnostics.limiterObservations)}
      </div>
      <div>Base fetch duration: {formatTiming("fetchMs")}</div>
      <div>
        Selection to fetch start: {formatTiming("selectionToFetchStartMs")}
      </div>
      <div>Base compact-queue wait: {formatTiming("compactQueueWaitMs")}</div>
      <div>Base worker duration: {formatTiming("baseWorkerExecutionMs")}</div>
      <div>
        Base result-transfer wait: {formatTiming("resultTransferWaitMs")}
      </div>
      <div>Base scene-ready wait: {formatTiming("sceneQueueWaitMs")}</div>
      <div>
        Selection to base-visible state (end-to-end, not additive):{" "}
        {formatTiming("selectionToBaseVisibleMs")}
      </div>
      <div>
        Enhancement compact-queue wait: {formatTiming("enhancementQueueWaitMs")}
      </div>
      <div>
        Enhancement worker duration:{" "}
        {formatTiming("enhancementWorkerExecutionMs")}
      </div>
      <div>
        Enhancement result-transfer wait:{" "}
        {formatTiming("enhancementResultTransferWaitMs")}
      </div>
      <div>
        Enhancement attachment wait: {formatTiming("enhancementAttachWaitMs")}
      </div>
      <div>
        Selection to enhanced state (optional, not additive):{" "}
        {formatTiming("selectionToEnhancedMs")}
      </div>
      <div>
        Current queued demand: {chunkStats.voxelPipeline.currentQueue.jobs} jobs
        / oldest{" "}
        {chunkStats.voxelPipeline.currentQueue.oldestDemandAgeMs.overall ===
        null
          ? "n/a"
          : `${chunkStats.voxelPipeline.currentQueue.oldestDemandAgeMs.overall.toFixed(0)} ms`}
      </div>
      <div>
        Executable stages:{" "}
        {formatOutcomes(
          Object.fromEntries(
            Object.entries(
              chunkStats.voxelPipeline.currentQueue.executableStages,
            ).map(([stage, usage]) => [stage, usage.jobs]),
          ),
        )}
      </div>
      <div>
        Non-executable demand:{" "}
        {formatOutcomes(
          chunkStats.voxelPipeline.currentQueue.nonExecutableDemand,
        )}
      </div>
      <div>
        Oldest by LOD:{" "}
        {formatAgeGroups(
          chunkStats.voxelPipeline.currentQueue.oldestDemandAgeMs.byLod,
        )}
      </div>
      <div>
        Oldest by safety:{" "}
        {formatAgeGroups(
          chunkStats.voxelPipeline.currentQueue.oldestDemandAgeMs.bySafetyClass,
        )}
      </div>
      <div>
        Oldest by coverage:{" "}
        {formatAgeGroups(
          chunkStats.voxelPipeline.currentQueue.oldestDemandAgeMs
            .byCoverageClass,
        )}
      </div>
      <div>
        Oldest by view:{" "}
        {formatAgeGroups(
          chunkStats.voxelPipeline.currentQueue.oldestDemandAgeMs.byViewClass,
        )}
      </div>
      <div>
        Oldest by phase:{" "}
        {formatAgeGroups(
          chunkStats.voxelPipeline.currentQueue.oldestDemandAgeMs.byPhase,
        )}
      </div>
      <div>
        Focus base deadline misses:{" "}
        {chunkStats.voxelPipeline.focusDeadlineMisses}
      </div>
      <div>
        Frame work time:{" "}
        {formatObservation("frameTimeMs", (value) => `${value.toFixed(1)} ms`)}
      </div>
      <div>
        Worker busy observations:{" "}
        {formatObservation(
          "workerBusyRatio",
          (value) => `${(value * 100).toFixed(0)}%`,
        )}
      </div>
      <div>
        Worker duration observations:{" "}
        {formatObservation(
          "workerDurationMs",
          (value) => `${value.toFixed(1)} ms`,
        )}
      </div>
      <div>
        Reserved expanded bytes:{" "}
        {formatObservation("reservedExpandedBytes", formatMemoryBytes)}
      </div>
      <div>
        Active / target worker observations:{" "}
        {formatObservation("activeWorkers", (value) => value.toFixed(0))} /{" "}
        {formatObservation("targetWorkers", (value) => value.toFixed(0))}
      </div>
      <div>
        Cancellations: {formatOutcomes(chunkStats.voxelPipeline.cancellations)}
      </div>
      <div>Discards: {formatOutcomes(chunkStats.voxelPipeline.discards)}</div>

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
        Glow pool: {chunkStats.blockLight.glowPoolUsed}/
        {chunkStats.blockLight.glowPoolAllocated}
      </div>
      <div>
        Point-light pool: {chunkStats.blockLight.pointLightPoolAllocated}
      </div>
      <div>Runtime: {chunkStats.blockLight.runtimeMs.toFixed(2)} ms</div>
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
        Block-light pool:{" "}
        {formatMemoryBytes(chunkStats.memoryBreakdown.blockLightPool)}
      </div>
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
        Emissive skipped: {chunkStats.voxelBenchmark.emissiveSkippedSamples}
      </div>
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
        Avg base / enhancement / combined output:{" "}
        {formatNullableBytes(
          chunkStats.voxelBenchmark.avgBaseWorkerOutputBytes,
        )}
        {" / "}
        {formatNullableBytes(
          chunkStats.voxelBenchmark.avgEnhancementWorkerOutputBytes,
        )}
        {" / "}
        {formatNullableBytes(
          chunkStats.voxelBenchmark.avgCombinedWorkerOutputBytes,
        )}
      </div>
      <div>
        Avg emissive bytes:{" "}
        {formatNullableBytes(chunkStats.voxelBenchmark.avgEmissiveBytes)}
      </div>
      <div>
        Avg emissive grid:{" "}
        {formatNullableMs(chunkStats.voxelBenchmark.avgEmissiveGridBuildMs)}
        {` (${chunkStats.voxelBenchmark.validSamples.emissiveGridBuild})`}
      </div>
      <div>
        Avg emissive bake:{" "}
        {formatNullableMs(chunkStats.voxelBenchmark.avgEmissiveBakeMs)}
        {` (${chunkStats.voxelBenchmark.validSamples.emissiveBake})`}
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
        Avg emitter metadata:{" "}
        {formatNullableBytes(chunkStats.voxelBenchmark.avgEmitterMetadataBytes)}
      </div>
      <div>
        Avg emitter power:{" "}
        {formatNullableCount(chunkStats.voxelBenchmark.avgEmitterPowerMin)}
        {" / "}
        {formatNullableCount(chunkStats.voxelBenchmark.avgEmitterPowerMax)}
      </div>
      <div>
        Avg emitter radius:{" "}
        {formatNullableCount(chunkStats.voxelBenchmark.avgEmitterRadiusMin)}
        {" / "}
        {formatNullableCount(chunkStats.voxelBenchmark.avgEmitterRadiusMax)}
      </div>
      <div>
        Avg receiver evaluations:{" "}
        {formatNullableCount(
          chunkStats.voxelBenchmark.avgEmissiveReceiverEvaluations,
        )}
        {" / probes "}
        {formatNullableCount(
          chunkStats.voxelBenchmark.avgEmissiveNeighborhoodCellProbes,
        )}
      </div>
      <div>
        Avg neighborhood buckets: non-empty{" "}
        {formatNullableCount(
          chunkStats.voxelBenchmark.avgEmissiveNonEmptyBuckets,
        )}
        {" / raw "}
        {formatNullableCount(
          chunkStats.voxelBenchmark.avgEmissiveRawBucketEntries,
        )}
        {" / unique "}
        {formatNullableCount(
          chunkStats.voxelBenchmark.avgEmissiveDeduplicatedNeighborhoodEntries,
        )}
      </div>
      <div>
        Avg final contributions:{" "}
        {formatNullableCount(
          chunkStats.voxelBenchmark.avgEmissiveCandidateVisits,
        )}
      </div>
      <div>
        Candidate cache: hit{" "}
        {formatNullableCount(chunkStats.voxelBenchmark.avgEmissiveCacheHits)}
        {" / miss "}
        {formatNullableCount(chunkStats.voxelBenchmark.avgEmissiveCacheMisses)}
        {" / entries "}
        {formatNullableCount(chunkStats.voxelBenchmark.avgEmissiveCacheEntries)}
      </div>
      <div>
        Candidate cache: fallback{" "}
        {formatNullableCount(
          chunkStats.voxelBenchmark.avgEmissiveUncachedFallbacks,
        )}
        {" / peak "}
        {formatNullableBytes(
          chunkStats.voxelBenchmark.avgEmissivePeakAccountedCacheBytes,
        )}
      </div>
      <div>
        Avg server run:{" "}
        {chunkStats.voxelBenchmark.avgServerRunMs === null
          ? "n/a"
          : `${chunkStats.voxelBenchmark.avgServerRunMs.toFixed(1)} ms`}
        {` (${chunkStats.voxelBenchmark.validSamples.serverRun})`}
      </div>
      <div>
        Avg server halo:{" "}
        {chunkStats.voxelBenchmark.avgServerHaloMs === null
          ? "n/a"
          : `${chunkStats.voxelBenchmark.avgServerHaloMs.toFixed(1)} ms`}
        {` (${chunkStats.voxelBenchmark.validSamples.serverHalo})`}
        {" (current generation only; cached halo timing is excluded)"}
      </div>
    </div>
  );
}
