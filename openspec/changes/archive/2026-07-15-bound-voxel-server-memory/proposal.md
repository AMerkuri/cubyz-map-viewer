## Why

Loading a large populated world can drive the voxel server to multi-gigabyte resident memory and eventually exhaust the host because halo and emitter-summary paths generate complete LOD 1 meshes merely to extract emitter sources, while CPU-derived concurrency multiplies those transient allocations. The server also accepts obsolete work without a queue bound or request-disconnect cancellation, and its disabled-by-default recycling and incomplete diagnostics do not contain or expose the resulting high-water memory.

## What Changes

- Add a lightweight, shared LOD 1 emitter-source extraction path that preserves emitter selection and open-face semantics without constructing, merging, encoding, or persisting voxel geometry.
- Use the lightweight extractor for neighboring LOD 1 halo sources and cold emitter-summary leaves while preserving the existing voxel payload and lighting contracts.
- Replace the uncapped hardware-derived default with a conservative documented voxel worker default, while retaining validated explicit `VOXEL_WORKERS` overrides and coordinating summary-leaf concurrency with the effective limit.
- Bound queued voxel generation work with a measured default of eight distinct jobs and reject excess admission predictably instead of retaining an unlimited request backlog. The recommended preset is `VOXEL_WORKERS=1` with `VOXEL_QUEUE_LIMIT=8`; higher worker counts are an explicit memory-throughput trade-off.
- Treat server-capacity responses as retryable client scheduling outcomes so overload protection does not permanently suppress required coverage.
- Propagate HTTP request disconnection into queued voxel work, remove jobs with no remaining consumers, and preserve shared work while at least one consumer remains.
- Enable conservative worker recycling by default after memory-heavy work, preserve explicit configuration overrides, and replace workers only while idle without losing admitted jobs.
- Extend metrics to report main-process memory, idle/post-transfer worker memory, queue admission and cancellation outcomes, summary traversal/build counts, and recycling decisions.
- Add hermetic regression and stress coverage for extractor equivalence, bounded admission, shared-request cancellation, recycling, and large-summary traversal behavior.
- Update server runtime and architecture documentation for the changed generation flow, limits, metrics, and environment configuration.

## Capabilities

### New Capabilities

- `voxel-request-admission-control`: Defines bounded voxel generation admission, shared consumer cancellation, overload responses, and queue diagnostics.

### Modified Capabilities

- `voxel-memory-management`: Requires conservative default worker/recycling limits and memory diagnostics that distinguish main-process, active-job, transferred-buffer, and idle worker memory.
- `voxel-summary-concurrency`: Requires cold summary leaves to use lightweight emitter extraction and bounds the effective default concurrency for memory-heavy summary work.
- `voxel-halo-emitter-performance`: Requires halo source discovery to avoid full neighboring mesh generation while preserving emitter and traversability semantics.
- `client-voxel-work-scheduling`: Requires temporary server-capacity responses to release fetch capacity and retry through normal prioritized demand without consuming the permanent failure budget.

## Impact

- Server generation and extraction logic in `src/server/services/voxel-generator.ts` and related parser/cache helpers.
- Emitter-summary construction in `src/server/services/voxel-emitter-summary-service.ts`.
- Worker configuration, protocol, lifecycle, and queueing in `src/server/services/voxel-worker-config.ts`, `src/server/services/voxel-worker-pool.ts`, and `src/server/workers/`.
- Request lifetime and overload handling in `src/server/api/voxels.ts` and `VoxelMeshService`.
- Client fetch outcome handling in `src/client/features/world-view/lib/voxel-requests.ts` and its scheduler integration.
- Server metrics and composition in `src/server/index.ts` and voxel service interfaces.
- Hermetic server, watcher, worker, and voxel contract tests under `test/`.
- `docs/architecture-overview.md`, `docs/server-specification.md`, and runtime/environment documentation.
- The binary voxel response format and normal client behavior remain compatible; overload responses and metrics gain documented server-side behavior.
