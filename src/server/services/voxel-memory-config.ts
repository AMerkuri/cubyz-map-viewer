export const DEFAULT_VOXEL_MEMORY_CACHE_SIZE = 1024;
export const DEFAULT_VOXEL_MEMORY_CACHE_BYTES = 256 * 1024 * 1024;
export const DEFAULT_VOXEL_WORKER_EMITTER_CACHE_SIZE = 64;
export const DEFAULT_VOXEL_WORKER_EMITTER_CACHE_SOURCES = 16_384;
export const DEFAULT_VOXEL_EMITTER_SUMMARY_CACHE_SIZE = 512;
export const DEFAULT_VOXEL_EMITTER_SUMMARY_CACHE_BYTES = 64 * 1024 * 1024;
export const DEFAULT_VOXEL_WORKER_RECYCLE_JOBS = 32;
export const DEFAULT_VOXEL_WORKER_RECYCLE_EXTERNAL_BYTES = 512 * 1024 * 1024;
export const DEFAULT_VOXEL_WORKER_RECYCLE_ARRAY_BUFFER_BYTES =
  512 * 1024 * 1024;

interface VoxelMemoryConfig {
  entryLimit: number;
  byteLimit: number;
  workerEmitterEntryLimit: number;
  workerEmitterSourceLimit: number;
  emitterSummaryEntryLimit: number;
  emitterSummaryByteLimit: number;
  recycleHeapBytes: number;
  recycleExternalBytes: number;
  recycleArrayBufferBytes: number;
  recycleCompletedJobs: number;
}

function recyclingThreshold(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function readVoxelMemoryCacheConfig(
  env: NodeJS.ProcessEnv,
): VoxelMemoryConfig {
  return {
    entryLimit: positiveInteger(
      env.VOXEL_MEMORY_CACHE_SIZE,
      DEFAULT_VOXEL_MEMORY_CACHE_SIZE,
    ),
    byteLimit: positiveInteger(
      env.VOXEL_MEMORY_CACHE_BYTES,
      DEFAULT_VOXEL_MEMORY_CACHE_BYTES,
    ),
    workerEmitterEntryLimit: positiveInteger(
      env.VOXEL_WORKER_EMITTER_CACHE_SIZE,
      DEFAULT_VOXEL_WORKER_EMITTER_CACHE_SIZE,
    ),
    workerEmitterSourceLimit: positiveInteger(
      env.VOXEL_WORKER_EMITTER_CACHE_SOURCES,
      DEFAULT_VOXEL_WORKER_EMITTER_CACHE_SOURCES,
    ),
    emitterSummaryEntryLimit: positiveInteger(
      env.VOXEL_EMITTER_SUMMARY_CACHE_SIZE,
      DEFAULT_VOXEL_EMITTER_SUMMARY_CACHE_SIZE,
    ),
    emitterSummaryByteLimit: positiveInteger(
      env.VOXEL_EMITTER_SUMMARY_CACHE_BYTES,
      DEFAULT_VOXEL_EMITTER_SUMMARY_CACHE_BYTES,
    ),
    recycleHeapBytes: recyclingThreshold(
      env.VOXEL_WORKER_RECYCLE_HEAP_BYTES,
      0,
      "VOXEL_WORKER_RECYCLE_HEAP_BYTES",
    ),
    recycleExternalBytes: recyclingThreshold(
      env.VOXEL_WORKER_RECYCLE_EXTERNAL_BYTES,
      DEFAULT_VOXEL_WORKER_RECYCLE_EXTERNAL_BYTES,
      "VOXEL_WORKER_RECYCLE_EXTERNAL_BYTES",
    ),
    recycleArrayBufferBytes: recyclingThreshold(
      env.VOXEL_WORKER_RECYCLE_ARRAY_BUFFER_BYTES,
      DEFAULT_VOXEL_WORKER_RECYCLE_ARRAY_BUFFER_BYTES,
      "VOXEL_WORKER_RECYCLE_ARRAY_BUFFER_BYTES",
    ),
    recycleCompletedJobs: recyclingThreshold(
      env.VOXEL_WORKER_RECYCLE_JOBS,
      DEFAULT_VOXEL_WORKER_RECYCLE_JOBS,
      "VOXEL_WORKER_RECYCLE_JOBS",
    ),
  };
}
