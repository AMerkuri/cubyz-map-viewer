export const DEFAULT_VOXEL_QUEUE_LIMIT = 8;
export const DEFAULT_VOXEL_WORKERS = 1;

export function resolveVoxelWorkerCount(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_VOXEL_WORKERS;
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

export function resolveVoxelQueueLimit(value: string | undefined): number {
  if (value === undefined) return DEFAULT_VOXEL_QUEUE_LIMIT;

  if (!/^\d+$/.test(value)) {
    throw new Error("VOXEL_QUEUE_LIMIT must be a positive integer");
  }

  const queueLimit = Number(value);
  if (!Number.isSafeInteger(queueLimit) || queueLimit < 1) {
    throw new Error("VOXEL_QUEUE_LIMIT must be a positive integer");
  }
  return queueLimit;
}
