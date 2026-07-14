## 1. Shared Configuration

- [x] 1.1 Add a single validated `VOXEL_WORKERS` resolver that preserves the existing hardware-derived default and rejects malformed, zero, or negative explicit values.
- [x] 1.2 Pass the resolved worker count through `VoxelMeshService` to both `VoxelWorkerPool` and `VoxelEmitterSummaryService`, without changing externally supplied test dependencies.

## 2. Summary Build Limiting

- [x] 2.1 Replace the single-active summary leaf-build gate with a bounded FIFO limiter configured from the shared worker count.
- [x] 2.2 Ensure only distinct cold LOD 1 `buildLeaf` executions acquire slots, preserving in-flight deduplication and releasing slots after success or failure.
- [x] 2.3 Add hermetic tests covering explicit concurrency, FIFO queueing, duplicate requests, cached reads, and capacity recovery after a rejected leaf build.

## 3. Documentation And Validation

- [x] 3.1 Update `.env.example`, `docs/server-specification.md`, and `docs/architecture-overview.md` to describe `VOXEL_WORKERS` as the shared worker and cold-summary concurrency limit, including the throughput/memory trade-off.
- [x] 3.2 Run focused summary/service tests, then `npm test && npm run check && npm run check:knip && npm run typecheck`.
- [x] 3.3 Run `npm run build` to verify the server TypeScript and worker boundaries.
