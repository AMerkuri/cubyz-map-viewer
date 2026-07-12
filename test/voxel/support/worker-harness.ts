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
