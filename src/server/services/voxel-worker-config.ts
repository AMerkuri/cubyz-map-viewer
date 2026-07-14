import { availableParallelism } from "node:os";

export function resolveVoxelWorkerCount(value: string | undefined): number {
  if (value === undefined) {
    return Math.max(1, Math.floor(availableParallelism() / 2));
  }

  if (!/^\d+$/.test(value)) {
    throw new Error("VOXEL_WORKERS must be a positive integer");
  }

  const workerCount = Number(value);
  if (!Number.isSafeInteger(workerCount) || workerCount < 1) {
    throw new Error("VOXEL_WORKERS must be a positive integer");
  }

  return workerCount;
}
