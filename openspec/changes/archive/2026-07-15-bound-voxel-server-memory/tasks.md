## 1. Baseline Coverage

- [x] 1.1 Add hermetic populated-column fixtures that exercise ordinary emissive blocks, shape-dependent represented LODs, transparent/model/semantic traversability, missing neighbors, vertical bounds, and empty emitter results.
- [x] 1.2 Add baseline assertions for represented emitter sources and uncapped decoded halo records before replacing the full-mesh extraction path.
- [x] 1.3 Add service and pool tests that reproduce unbounded distinct admission, same-key sharing, disconnect races, invalidation of queued work, and post-worker duplicate pipeline work using fakes rather than a running server.

## 2. Lightweight Emitter Extraction

- [x] 2.1 Factor the minimum shared column parsing, block representation, emitted-color, traversability, and open-face primitives out of `voxel-generator.ts` without changing normal mesh output.
- [x] 2.2 Implement a named lightweight LOD 1 represented-emitter extractor that returns world-coordinate sources and phase metrics without allocating faces, merged/model geometry, boundary samples, encoded payloads, or persistent voxel meshes.
- [x] 2.3 Replace `VoxelEmitterSummaryService.buildLeaf` full mesh generation with lightweight extraction while preserving summary source signatures, clustering, persistence, invalidation, and bounded leaf concurrency.
- [x] 2.4 Replace neighboring halo `generateVoxelMesh` recursion with the lightweight extractor while preserving worker-local in-flight sharing and bounded resolved source caching.
- [x] 2.5 Verify extractor output, summary clusters, halo records, cap-pressure behavior, and boundary lighting against the baseline fixtures; bump derived cache versions only where semantic inputs changed.

## 3. Safe Concurrency Defaults

- [x] 3.1 Change unset `VOXEL_WORKERS` resolution to one, retain strict positive explicit overrides, and keep worker-pool and cold summary-extraction concurrency aligned to the resolved value.
- [x] 3.2 Add configuration and composition tests for unset, explicit, malformed, zero, and negative worker values and for the effective summary concurrency.
- [x] 3.3 Log effective worker, summary-extraction, queue, and recycling limits at startup so operators can verify containment settings.

## 4. Admission And Cancellation

- [x] 4.1 Add validated `VOXEL_QUEUE_LIMIT` configuration with a measured finite default of 8 and expose queue capacity through the worker-pool interface.
- [x] 4.2 Implement bounded distinct-job admission and removable queued jobs in `VoxelWorkerPool`, preserving FIFO dispatch, same-key service deduplication, shutdown behavior, and exactly-once settlement.
- [x] 4.3 Extend `VoxelMeshService` in-flight ownership across generation, source validation, cache installation, and compression, with per-consumer abort tracking and invalidation-aware queued cancellation.
- [x] 4.4 Skip post-processing for orphaned running results unless compatible demand rejoins before completion, while retaining stale-result and cache-validity protections.
- [x] 4.5 Connect premature Express request close/abort to service consumer cancellation and return `503 Service Unavailable` with `Retry-After` when distinct queue admission is full.
- [x] 4.6 Make the client classify documented capacity responses as delayed retryable demand without incrementing permanent failure counts or retrying tiles that have left demand.
- [x] 4.7 Add hermetic pool, service, route, and client tests for queue saturation, duplicate consumers, partial and final disconnect, reconnect-before-completion, invalidation, overload retry delay, and non-capacity errors.

## 5. Recycling And Diagnostics

- [x] 5.1 Extend the worker protocol to report an idle-boundary memory snapshot after transferable result ownership passes to the main thread, keeping any pre-transfer measurement explicitly phase-labelled.
- [x] 5.2 Change absent recycling configuration to defaults of 32 completed jobs and 512 MiB post-transfer external/ArrayBuffer high-water, preserve explicit zero disablement and positive overrides, and reject malformed or negative values.
- [x] 5.3 Verify serialized idle worker replacement, queued-work preservation, threshold precedence, explicit disablement, and retirement reason metrics with fake workers.
- [x] 5.4 Extend voxel metrics with main-process memory, queue capacity and admission outcomes, consumer cancellation/orphan outcomes, complete-pipeline sharing, idle worker values, and summary node/leaf traversal counters.
- [x] 5.5 Add metrics tests that distinguish main-process memory from worker memory, node traversal from cold leaf extraction, and transferred buffers from idle worker retention.

## 6. Documentation

- [x] 6.1 Update `docs/architecture-overview.md` with lightweight emitter extraction, complete-pipeline sharing, request cancellation, bounded admission, and worker lifecycle flow.
- [x] 6.2 Update `docs/server-specification.md` with `503` overload behavior, `Retry-After`, metrics fields, one-worker default, queue configuration, recycling defaults, explicit disablement, and memory-throughput trade-offs.
- [x] 6.3 Update `docs/client-specification.md` for temporary overload retry semantics and update environment/runtime examples for all changed configuration values.

## 7. Verification

- [x] 7.1 Run focused correctness suites for server voxel generation, voxel contracts, service/API behavior, client scheduling, terrain seams, halo retention, and worker lifecycle; resolve all failures.
- [x] 7.2 Run `npm test && npm run check && npm run check:knip && npm run typecheck && npm run build` and resolve all failures.
- [x] 7.3 Repeat the large-save halo-on measurement with default settings and explicit higher worker counts, recording process high-water/idle RSS, summary leaf extraction counts, queue outcomes, retirements, payload equivalence, and request latency against the captured baseline.
