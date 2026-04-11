import { parentPort, workerData } from "node:worker_threads";

import { generateVoxelMesh } from "../services/voxel-generator.js";
import type {
  VoxelJobResult,
  VoxelWorkerData,
  VoxelWorkerMessage,
} from "./voxel-worker-protocol.js";

const data = workerData as VoxelWorkerData;

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
      job.lod,
      job.regionX,
      job.regionY,
    );
    const runMs = performance.now() - startedAt;
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
          }
      : {
          id: job.id,
          key: job.key,
          globalEpoch: job.globalEpoch,
          keyEpoch: job.keyEpoch,
          status: "empty",
          runMs,
          stats: generated.stats,
        };
    if (result.status === "ok") {
      parentPort?.postMessage(result, [result.buffer]);
    } else {
      parentPort?.postMessage(result);
    }
  } catch (error) {
    const result: VoxelJobResult = {
      id: job.id,
      key: job.key,
      globalEpoch: job.globalEpoch,
      keyEpoch: job.keyEpoch,
      status: "error",
      error: error instanceof Error ? error.message : String(error),
      runMs: performance.now() - startedAt,
    };
    parentPort?.postMessage(result);
  }
});
