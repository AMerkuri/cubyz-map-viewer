type WorkerMesh = ReturnType<
  typeof import("../../../src/client/features/world-view/workers/voxel-mesh.worker.js").buildMeshArrays
>;

let workerModule:
  | Promise<
      typeof import("../../../src/client/features/world-view/workers/voxel-mesh.worker.js")
    >
  | undefined;

export async function buildWithProductionWorker(
  buffer: ArrayBuffer,
  options: {
    bakeEmissiveAttributes?: boolean;
    candidateNeighborhoodMode?: "cached" | "uncached";
    candidateCacheMaxBytes?: number;
  } = {},
): Promise<WorkerMesh> {
  if (!workerModule) {
    Object.assign(globalThis, { self: globalThis });
    workerModule = import(
      "../../../src/client/features/world-view/workers/voxel-mesh.worker.js"
    );
  }
  return (await workerModule).buildMeshArrays(
    buffer,
    options.bakeEmissiveAttributes ?? true,
    options.candidateNeighborhoodMode,
    options.candidateCacheMaxBytes,
  );
}

export async function buildProgressiveWithProductionWorker(
  buffer: ArrayBuffer,
  options: {
    candidateNeighborhoodMode?: "cached" | "uncached";
    candidateCacheMaxBytes?: number;
  } = {},
) {
  if (!workerModule) {
    Object.assign(globalThis, { self: globalThis });
    workerModule = import(
      "../../../src/client/features/world-view/workers/voxel-mesh.worker.js"
    );
  }
  const worker = await workerModule;
  const baseStartedAt = performance.now();
  const base = worker.buildMeshArrays(
    buffer,
    false,
    options.candidateNeighborhoodMode,
    options.candidateCacheMaxBytes,
  );
  const baseMs = performance.now() - baseStartedAt;
  const retained = worker.getRetainedEnhancementBuffer(buffer, base, true);
  const enhancementStartedAt = performance.now();
  const enhancement = retained
    ? worker.buildEmissiveEnhancementArrays(
        retained,
        options.candidateNeighborhoodMode,
        options.candidateCacheMaxBytes,
      )
    : null;
  const enhancementMs = retained ? performance.now() - enhancementStartedAt : 0;
  return {
    base,
    retained,
    enhancement,
    baseMs,
    enhancementMs,
  };
}
