import { parentPort, workerData } from "node:worker_threads";

import {
  configureRepresentedEmitterCache,
  generateVoxelMesh,
  getRepresentedEmitterCacheMetrics,
} from "../services/voxel-generator.js";
import type {
  VoxelJobResult,
  VoxelWorkerData,
  VoxelWorkerDiagnostics,
  VoxelWorkerMessage,
} from "./voxel-worker-protocol.js";

const data = workerData as VoxelWorkerData;
let completedJobs = 0;

configureRepresentedEmitterCache(
  data.representedEmitterCacheMaxEntries,
  data.representedEmitterCacheMaxSources,
);

function getDiagnostics(
  phase: VoxelWorkerDiagnostics["phase"],
): VoxelWorkerDiagnostics {
  const memory = process.memoryUsage();
  const cache = getRepresentedEmitterCacheMetrics();
  return {
    phase,
    heapUsed: memory.heapUsed,
    heapTotal: memory.heapTotal,
    external: memory.external,
    arrayBuffers: memory.arrayBuffers,
    completedJobs,
    representedEmitterCacheEntries: cache.entries,
    representedEmitterCacheSources: cache.sources,
    representedEmitterInFlight: cache.inFlight,
  };
}

if (!parentPort) {
  throw new Error("Voxel worker started without parentPort");
}

parentPort.on("message", async (message: VoxelWorkerMessage) => {
  if (message.type === "shutdown") {
    process.exit(0);
  }
  if (message.type !== "job") return;

  const { job } = message;
  const startedAt = performance.now();
  try {
    const generated = await generateVoxelMesh(
      data.savePath,
      data.blockColors,
      data.blockShapes,
      job.lod,
      job.regionX,
      job.regionY,
      {
        includeHaloEmitters: job.includeHaloEmitters !== false,
        emitterSummary: job.emitterSummary,
        emitterSummaryMetrics: job.emitterSummaryMetrics,
      },
    );
    const runMs = performance.now() - startedAt;
    completedJobs++;
    const preTransferDiagnostics = getDiagnostics("pre-transfer");
    const result: VoxelJobResult = generated.buffer
      ? generated.stats
        ? {
            id: job.id,
            key: job.key,
            globalEpoch: job.globalEpoch,
            keyEpoch: job.keyEpoch,
            status: "ok",
            buffer: generated.buffer,
            runMs,
            preTransferDiagnostics,
            stats: generated.stats,
          }
        : {
            id: job.id,
            key: job.key,
            globalEpoch: job.globalEpoch,
            keyEpoch: job.keyEpoch,
            status: "error",
            error: "Voxel mesh generation returned a buffer without stats",
            runMs,
            preTransferDiagnostics,
          }
      : {
          id: job.id,
          key: job.key,
          globalEpoch: job.globalEpoch,
          keyEpoch: job.keyEpoch,
          status: "empty",
          runMs,
          preTransferDiagnostics,
          stats: generated.stats,
        };
    if (result.status === "ok") {
      parentPort?.postMessage(result, [result.buffer]);
    } else {
      parentPort?.postMessage(result);
    }
    parentPort?.postMessage({
      type: "idle",
      id: job.id,
      diagnostics: getDiagnostics("idle"),
    });
  } catch (error) {
    completedJobs++;
    const result: VoxelJobResult = {
      id: job.id,
      key: job.key,
      globalEpoch: job.globalEpoch,
      keyEpoch: job.keyEpoch,
      status: "error",
      error: error instanceof Error ? error.message : String(error),
      runMs: performance.now() - startedAt,
      preTransferDiagnostics: getDiagnostics("pre-transfer"),
    };
    parentPort?.postMessage(result);
    parentPort?.postMessage({
      type: "idle",
      id: job.id,
      diagnostics: getDiagnostics("idle"),
    });
  }
});
