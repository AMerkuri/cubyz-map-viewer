## 1. Memory Configuration and Accounting

- [x] 1.1 Add validated server configuration for mesh-cache byte limits, worker emitter-cache limits, and optional worker recycling thresholds, preserving `VOXEL_MEMORY_CACHE_SIZE` as an entry cap.
- [x] 1.2 Extend the LRU cache utility or add focused voxel-cache accounting so insertions, variant changes, replacements, and evictions maintain exact retained-byte totals.
- [x] 1.3 Apply byte-weighted eviction to raw, gzip, and Brotli voxel buffers, counting shared identity storage once and declining to retain individually oversized entries.
- [x] 1.4 Expose mesh-cache bytes, entry counts, variant bytes, eviction counts, and oversized-entry skips through voxel metrics.
- [x] 1.5 Add hermetic tests for byte eviction order, shared-buffer accounting, compression-variant growth, oversized entries, and invalid configuration fallback.

## 2. Worker Retention and Lifecycle

- [x] 2.1 Separate represented-emitter in-flight deduplication from resolved worker cache values and implement true LRU eviction by entry and aggregate source-count limits.
- [x] 2.2 Extend worker success and failure messages with isolate heap, external, ArrayBuffer, completed-job, and represented-emitter cache measurements.
- [x] 2.3 Record per-slot memory measurements and retirement reasons in `VoxelWorkerPool` and expose aggregate worker diagnostics through voxel metrics.
- [x] 2.4 Implement serialized idle-worker retirement and replacement for enabled isolate-memory or completed-job thresholds without dropping queued or running jobs.
- [x] 2.5 Correct worker destroy/error paths so pending jobs settle and dispatch resumes safely during replacement.
- [x] 2.6 Add hermetic worker-pool tests for threshold retirement, disabled recycling, simultaneous eligibility, queue preservation, error replacement, and shutdown settlement.

## 3. Emitter Summary Retention

- [x] 3.1 Remove complete summaries from the unbounded ETag handoff map or replace it with explicitly bounded preparation state keyed by source version.
- [x] 3.2 Ensure per-key and global invalidation clear prepared summary state and cannot allow stale in-flight work to repopulate invalid entries.
- [x] 3.3 Add route/service tests covering matching `304` requests, failed mesh requests, per-key invalidation, and global clearing without retained preparation entries.
- [x] 3.4 Add validated entry and estimated-byte limits for resolved emitter-summary nodes, retaining weighted LRU behavior and declining individually oversized nodes.
- [x] 3.5 Expose main-isolate emitter-summary cache entries, estimated bytes, retained clusters, evictions, oversized skips, and active work through voxel metrics; prevent invalidated in-flight summary work from repopulating the cache.
- [x] 3.6 Add hermetic tests for summary-cache byte eviction order, dense-node accounting, oversized nodes, invalid configuration fallback, and stale completion after per-key or global invalidation.

## 4. Generation Peak Reduction

- [x] 4.1 Preserve greedy/model quad ordering through generation so encoding does not concatenate, copy, and sort the complete quad collection.
- [x] 4.2 Refactor binary encoding to compute exact section offsets and write directly into one final buffer without universal structure-of-arrays staging or model-vertex arrays for greedy quads.
- [x] 4.3 Replace persistent-cache full-payload concatenation with vectored or sequential metadata and payload writes.
- [x] 4.4 Extend server, client, and contract voxel suites to prove mixed greedy/model payloads, emitters, palette data, compression, and persistent-cache round trips remain equivalent.

## 5. Documentation and Validation

- [x] 5.1 Document cache byte limits, worker cache controls, recycling thresholds, defaults, disable behavior, and metrics in `docs/server-specification.md`.
- [x] 5.2 Update `docs/architecture-overview.md` with byte-budgeted retention, worker memory reporting, and idle-worker recycling flow.
- [x] 5.3 Add an opt-in real-save workload harness with a checked-in request manifest, isolated temporary voxel cache root, bounded request concurrency, compressed response draining, RSS sampling, and JSON/table results for cold and warm phases.
- [x] 5.4 Use the harness with equivalent cold and warm workloads at one and eight workers, recording startup, phase peak, post-work, and post-idle RSS together with mesh, worker, and summary-cache metrics.
- [x] 5.5 Update `docs/server-specification.md` and `docs/architecture-overview.md` with resolved summary-cache controls, estimated-byte metric semantics, and the controlled workload workflow.
- [x] 5.6 Run `npm test && npm run check && npm run check:knip && npm run typecheck`.
- [x] 5.7 Run `npm run build` to verify worker protocol, source-worker, and production-worker boundaries.
