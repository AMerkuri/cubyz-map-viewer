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
): Promise<WorkerMesh> {
  if (!workerModule) {
    Object.assign(globalThis, { self: globalThis });
    workerModule = import(
      "../../../src/client/features/world-view/workers/voxel-mesh.worker.js"
    );
  }
  return (await workerModule).buildMeshArrays(buffer, true);
}

export async function buildProgressiveWithProductionWorker(
  buffer: ArrayBuffer,
) {
  if (!workerModule) {
    Object.assign(globalThis, { self: globalThis });
    workerModule = import(
      "../../../src/client/features/world-view/workers/voxel-mesh.worker.js"
    );
  }
  const worker = await workerModule;
  const baseStartedAt = performance.now();
  const base = worker.buildMeshArrays(buffer, false);
  const baseMs = performance.now() - baseStartedAt;
  const retained = worker.getRetainedEnhancementBuffer(buffer, base, true);
  const enhancementStartedAt = performance.now();
  const enhancement = retained
    ? worker.buildEmissiveEnhancementArrays(retained)
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
