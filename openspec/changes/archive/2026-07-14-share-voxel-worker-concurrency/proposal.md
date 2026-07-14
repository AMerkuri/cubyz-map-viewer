## Why

Fresh voxel-cache warmup dispatches work at the configured worker-pool size, while cold LOD 1 emitter-summary builds are always serialized in the server's main isolate. This makes `VOXEL_WORKERS` an incomplete concurrency control and leaves fresh-cache throughput artificially constrained when operators intentionally provision more voxel workers.

## What Changes

- Make the resolved `VOXEL_WORKERS` value the shared concurrency limit for `VoxelWorkerPool` and cold emitter-summary leaf builds.
- Replace the fixed one-at-a-time summary-build gate with a bounded, fair limiter that preserves per-summary in-flight deduplication.
- Resolve and validate the worker count once at server composition so the pool, summary service, and startup warmup use the same effective value.
- Document the shared runtime behavior and fresh-cache memory/throughput trade-off.

## Capabilities

### New Capabilities
- `voxel-summary-concurrency`: Configurable bounded concurrency for cold emitter-summary leaf builds, shared with the voxel worker pool.

### Modified Capabilities

None.

## Impact

- Affected server code: `src/server/index.ts`, `VoxelMeshService`, and `VoxelEmitterSummaryService`.
- Affected configuration and runtime documentation: `.env.example`, `docs/server-specification.md`, and `docs/architecture-overview.md`.
- Affected validation: hermetic service tests for concurrent cold summaries and startup/fresh-cache behavior, plus the normal server type, lint, and build checks.
