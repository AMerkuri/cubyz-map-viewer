## Context

`VoxelEmitterSummaryService` currently deduplicates requests by summary key, persists completed nodes, and protects cold LOD 1 generation with a single global main-isolate queue. `VoxelWorkerPool` resolves its own size from `VOXEL_WORKERS` or its hardware-based default, while startup warmup derives its request fan-out from the pool's live worker count. A fresh persistent cache can therefore queue many mesh requests behind one summary leaf at a time.

The active `reduce-server-memory-retention` change deliberately added the serialized summary queue to prevent many overlapping high-memory leaf builds. This change keeps the protection but makes its upper bound the same explicit resource-control setting that determines voxel worker capacity.

## Goals / Non-Goals

**Goals:**

- Give `VoxelWorkerPool`, `VoxelEmitterSummaryService`, and startup warmup one resolved `VOXEL_WORKERS` concurrency value.
- Bound distinct cold LOD 1 summary leaf builds to that value while retaining existing per-key in-flight deduplication.
- Keep the limiter FIFO and release capacity after successful and failed builds.
- Keep the effective concurrency positive and deterministic when `VOXEL_WORKERS` is missing or invalid.
- Document the shared setting and its memory-versus-throughput trade-off.

**Non-Goals:**

- Moving emitter-summary generation into worker isolates or changing the voxel worker protocol.
- Making recursive parent-summary aggregation independently configurable.
- Adding a new environment variable solely for summary concurrency.
- Changing voxel payloads, cache identities, compression behavior, or HTTP/WebSocket contracts.

## Decisions

### Resolve worker concurrency once in server composition

The server composition root will resolve `VOXEL_WORKERS` into one validated positive integer. When it is unset, it will use the existing worker-pool default derived from `availableParallelism`; when it is malformed, zero, or negative, startup will fail rather than silently construct inconsistent capacities. The resolved value is passed explicitly to `VoxelMeshService`, which passes it to both `VoxelWorkerPool` and the internally created `VoxelEmitterSummaryService`.

This avoids separately reproducing hardware-default logic and ensures startup warmup continues to derive the same number from the started pool. Direct unit construction can retain safe positive defaults, but application runtime must have one authoritative value.

Alternative considered: pass the raw environment variable into each service. This would duplicate parsing and can let invalid or absent values resolve differently over time.

### Generalize the leaf queue into a bounded FIFO limiter

The single `leafBuildActive` flag becomes a limiter with a configured maximum, an active count, and queued waiters. A cold LOD 1 build acquires a slot immediately when capacity remains; otherwise it waits in arrival order. The slot is released in `finally`, so a build error cannot stall subsequent work.

The limiter surrounds only `buildLeaf`, which contains the heavyweight region parsing and represented-source construction. Signature calculation, persistent cache reads/writes, parent aggregation, and requests resolving to the same `inFlight` promise remain outside it. This maintains existing cache and deduplication semantics while bounding the exact high-memory phase.

Alternative considered: limit whole `getNode` calls. That would serialize cache reads and recursive aggregation unnecessarily, and could deadlock nested parent-to-child node requests under a small limit.

### Share a limit, not execution resources

`VOXEL_WORKERS=N` permits at most `N` summary leaf builds and maintains a worker pool of `N` isolates. The two workloads are not a single global scheduler: summary generation remains on the main isolate while mesh generation runs in worker isolates. The shared number expresses an operator-selected parallelism budget, not a guarantee that no more than `N` heavyweight operations exist process-wide.

Alternative considered: reserve a separate fraction of workers for summary work. Summary work does not run in the worker pool, and a second parameter would complicate the requested configuration model.

## Risks / Trade-offs

- [Higher `VOXEL_WORKERS` can overlap multiple memory-heavy main-isolate leaf builds] -> Keep the concurrency bounded, retain memory cache and worker-recycling controls, and document that operators can set `VOXEL_WORKERS=1` for the prior conservative behavior.
- [Main-isolate CPU work may not scale linearly] -> Limit only asynchronous heavyweight leaf work, preserve FIFO ordering, and measure fresh-cache warmup before increasing production defaults.
- [Invalid configuration can prevent startup] -> Validate once with a clear error naming `VOXEL_WORKERS`; do not silently select different capacities for different components.
- [Limiter bugs can leak capacity after failures] -> Release slots in `finally` and add hermetic tests for both success and rejection paths.

## Migration Plan

1. Add one worker-count resolver at server composition and pass its result to the mesh and summary services.
2. Replace the summary service's one-slot state with the bounded FIFO limiter.
3. Add service-level concurrency tests and update runtime documentation and `.env.example` comments.
4. Run the voxel/core suites, static checks, and production build.

Rollback is configuration-first: set `VOXEL_WORKERS=1` to restore one-at-a-time cold leaf builds and a one-worker pool. No cache migration or payload invalidation is required.

## Open Questions

- Should a later benchmark report observed maximum summary leaf concurrency as an operational metric, or are existing request and worker diagnostics sufficient?
- Is the existing hardware-derived default appropriate now that it controls main-isolate summary overlap as well as worker isolates?
