## Context

Large populated saves expose two multiplicative server workloads. Normal LOD 1 halo collection requests represented emitter sources from eight neighboring columns, and cold coarse-LOD summaries recursively request represented sources from many LOD 1 leaves. Both paths currently call `generateVoxelMesh` with `returnRepresentedSources`, but that option still parses the complete column, discovers and merges visible geometry, encodes a binary mesh, and only then returns the emitter sources. A single LOD 32 summary neighborhood can traverse up to 9,216 LOD 1 leaves.

Measurements on a large save with one worker and halo disabled showed a 3.9 GiB process high-water mark, roughly 3.1-3.5 GiB settled RSS, and hundreds of thousands of summary-cache evictions per view load. Worker diagnostics later fell while process RSS remained high, indicating collectible generation allocations whose committed pages were retained. The default worker count is half of available CPU parallelism, cold summary concurrency uses the same value in the main isolate, the worker queue has no admission bound, HTTP disconnects do not cancel server work, and all recycling thresholds are disabled unless configured.

The binary voxel payload, cache validity, emitted-light continuity, coordinate system, and route compression contract must remain stable. The solution must preserve same-key in-flight sharing and avoid cancelling useful work merely because one of several consumers disconnects.

## Goals / Non-Goals

**Goals:**

- Remove geometry construction and binary encoding from emitter-only halo and summary work.
- Bound default concurrent memory-heavy generation and queued server work.
- Stop queued work when no request still needs it and avoid post-processing orphaned running results.
- Recycle high-water worker isolates conservatively without dropping admitted jobs.
- Keep temporary overload recoverable by the existing prioritized client demand scheduler.
- Expose enough process, worker, queue, cancellation, and summary metrics to verify memory containment.
- Preserve voxel geometry, emitter records, cache invalidation, and lighting behavior.

**Non-Goals:**

- Changing LOD selection distances, render distance, client mesh expansion, or browser warm-cache budgets.
- Introducing hard interruption inside a running worker generation job; running orphaned jobs may finish before their result is discarded.
- Replacing the summary quadtree or changing its clustering and persistent format unless extractor integration requires a cache-version bump.
- Defining a universal process RSS ceiling independent of save density and individual payload size.
- Changing the binary voxel response format or compression requirement.

## Decisions

### Extract represented emitters without producing geometry

Introduce a dedicated server service/helper that loads an LOD 1 column and returns represented emitter sources using the same block-shape resolution, surface bounds, traversability, emitted-color, represented-LOD, and open-face rules as the current generator. Factor shared parsing and semantic decisions out of `generateVoxelMesh` only where necessary; the emitter-only path must not create face maps, greedy/model quad arrays, boundary geometry samples, encoded payloads, or persistent voxel meshes.

The extractor will return source records in world coordinates plus phase metrics such as regions parsed, chunks inspected, source count, and elapsed time. Normal target-column generation may reuse the extractor's shared primitives but remains responsible for mesh-local emitter rebasing and payload capping. Halo collection will request eight neighboring extractor results through the existing worker-local resolved/in-flight cache. `VoxelEmitterSummaryService.buildLeaf` will call the same extractor directly and cluster its result.

Alternatives considered:

- Early-returning from `generateVoxelMesh` after represented sources are computed would avoid encoding but would still retain most geometry traversal and obscure which allocations are forbidden.
- Reading only block entities would be cheaper but incorrect because ordinary emissive blocks, block-shape LOD representation, and open-face semantics depend on decoded voxel content.
- Maintaining separate halo and summary extractors would duplicate semantic logic and risk lighting divergence.

### Make the safe default one memory-heavy generation at a time

When `VOXEL_WORKERS` is unset, resolve it to one rather than half of hardware parallelism. An explicit positive `VOXEL_WORKERS` value remains authoritative for operators who accept the throughput-memory trade-off, and the effective value continues to bound both worker slots and cold summary-leaf extraction. Startup logs and documentation will state the effective value and its dual impact.

The lightweight extractor should make explicit higher concurrency practical, but correctness and host safety cannot assume a particular save density. A default of one follows the measured safe diagnostic configuration and avoids deriving a memory decision solely from CPU count.

Alternatives considered:

- Capping the hardware default at two still permits two unknown multi-gigabyte jobs before the extractor has proved its peak bound.
- Deriving count from total system memory requires a reliable per-job estimate that does not exist and would behave unpredictably in containers.
- Keeping the current default and relying only on recycling cannot prevent simultaneous transient peaks.

### Bound admission after same-key deduplication

Extend the voxel pool with a validated queue-entry limit. The default is 8 queued distinct jobs, configurable through `VOXEL_QUEUE_LIMIT`; running jobs do not count against queued capacity. `VoxelMeshService` will first join compatible same-key/version work and only then attempt admission, so additional consumers of existing work do not consume queue capacity or receive overload. Post-implementation Extreme-preset measurement found a peak queue depth of five with one worker, so eight retains burst headroom without preserving the original 32-job backlog.

If a distinct job cannot be admitted, the route returns `503 Service Unavailable` with a short `Retry-After` value and no voxel body. The client classifies this response as temporary capacity pressure: it releases the active fetch slot, does not increment the permanent failure budget, and allows still-demanded work to be selected again through normal priority scheduling. The server does not maintain an additional hidden retry queue.

Alternatives considered:

- A limit of 32 accepts a complete 8-20 request client burst but retains more obsolete work than the measured scheduler needs; delayed overload retry now absorbs excess demand safely.
- Blocking route handlers before queue admission would merely move the unbounded backlog into HTTP promises and sockets.
- Returning a generic `500` would mix capacity with generation errors and consume the client's finite failure budget.

### Track consumers and cancel only orphaned work

The voxel route will create an `AbortSignal` tied to premature request close/abort and pass it to `VoxelMeshService`. Each shared in-flight key/version operation tracks its active consumers across generation, source-signature validation, cache installation, and compression. A disconnected consumer stops waiting without rejecting other consumers.

When the last consumer leaves a queued operation, the pool removes and rejects that queue entry. When the last consumer leaves a running operation, the worker is allowed to finish, but the service marks the operation orphaned and skips source-signature recomputation, compression, cache installation, and response work unless a new compatible consumer joins before completion. Invalidation similarly makes obsolete versions ineligible for post-processing and removes them from the queue where possible.

The in-flight map will represent the complete shared pipeline rather than only the worker promise. This closes the current interval in which worker completion removes deduplication before cache installation and compression finish.

Alternatives considered:

- Terminating a worker on every orphaned running job would reclaim work sooner but destroy useful worker caches, complicate races, and make camera movement cause worker churn.
- Caching every orphaned result can help future requests but continues expensive post-processing after all known demand disappeared.
- Treating the first disconnect as job cancellation would incorrectly fail same-key consumers.

### Enable conservative routine recycling by default

Retain the existing idle replacement protocol and serialized routine retirement. Change missing recycling configuration to documented positive defaults while preserving explicit `0` as disablement. Use a completed-job default of 32 as the deterministic backstop and a post-transfer worker ArrayBuffer/external-memory threshold of 512 MiB as an earlier high-water trigger. Explicit positive environment values override these defaults independently.

Worker diagnostics used for recycling will be emitted after transferable result ownership has passed to the main thread and on the idle side of the job boundary. The pre-transfer result may still carry generation metrics, but it will not drive high-water retirement. Recycling decisions and reasons remain observable.

Alternatives considered:

- Recycling after every job maximizes reclamation but loses useful caches and worker startup throughput.
- Completed-job recycling alone does not react promptly to one pathological column.
- Memory thresholds based on the current pre-transfer diagnostic conflate the expected response buffer with retained isolate memory.

### Report process and phase-specific pressure

Extend `/api/voxels/metrics` without changing voxel payloads. Add main-process `process.memoryUsage()` values, queue limit/admission rejection/cancellation/orphan counters, complete-pipeline in-flight consumers, idle worker diagnostics, and summary node memory-hit, disk-hit, build, leaf-extraction, queue-depth, and eviction counters. Existing cumulative timing fields remain compatible.

Tests and operational comparisons will use bounded counters and before/after deltas rather than treating a single stale worker snapshot as current retained memory.

## Risks / Trade-offs

- [Emitter extraction diverges from mesh semantics] -> Share shape resolution and traversability primitives, compare extracted records against the current path on hermetic fixtures, and retain boundary/cap-pressure lighting tests.
- [One-worker default reduces cold-cache throughput] -> Prefer host stability by default, document explicit overrides, and recover throughput through cheaper extraction rather than concurrency.
- [A queue limit produces temporary coverage gaps] -> Admit same-key consumers before the limit, retain measured burst headroom, return retry metadata, and make overload retryable without permanent failure accounting.
- [Disconnected running jobs still consume CPU and transient memory] -> Skip all avoidable post-processing, count orphan completions, and leave cooperative worker interruption for a later change if measurements justify its complexity.
- [Frequent recycling degrades cache reuse] -> Combine a moderate job-count backstop with post-transfer high-water thresholds and serialize routine retirement.
- [Main-isolate summary extraction can still retain allocator high-water] -> Remove full geometry allocations first, expose main-process metrics, and retain bounded summary concurrency; move summary extraction into a separate pool only if measurements remain pathological.
- [Summary cache churn remains high] -> Measure node reads/builds separately from leaf extraction; defer cache-sizing or quadtree redesign until the lightweight path isolates its actual cost.

## Migration Plan

1. Introduce and validate the lightweight extractor behind existing internal call sites without changing route payloads.
2. Switch summary leaves and halo neighbor lookup to the extractor and bump persistent cache versions only if source semantics change.
3. Add complete-pipeline consumer tracking, bounded queue admission, overload handling, and client retry classification.
4. Enable new worker and recycling defaults with startup logging and environment documentation.
5. Add metrics and compare halo-on large-save behavior with one worker, explicit higher worker counts, cold summaries, disconnect storms, and repeated loads.
6. Deploy with conservative defaults; rollback can restore prior environment values or revert the change without data migration because voxel and summary caches are derived data.

## Open Questions

- Extreme-preset validation resolved the admission default at 8 queued jobs: the one-worker run peaked at five queued jobs, while eight workers reached the 6 GiB safety cutoff without building a queue. The independent 32-completed-job recycling backstop remains unchanged.
- If post-transfer diagnostics remain too stale without explicit garbage collection, retirement should use completed-job bounds as authoritative and memory thresholds as advisory rather than adding production forced-GC behavior.
