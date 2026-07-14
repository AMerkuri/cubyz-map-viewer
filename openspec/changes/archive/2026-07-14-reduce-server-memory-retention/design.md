## Context

The voxel server uses a count-limited main-thread mesh cache, a separate emitter-summary cache, and a represented-emitter cache in every worker isolate. A generation job also holds parsed regions, string-keyed traversal state, face and quad objects, encoder scratch arrays, and the final payload at overlapping points. The final payload is transferred to the main thread without copying, but worker isolates and native allocators remain alive and can preserve their high-water allocation after the job completes.

A controlled comparison found an approximately 270 MiB warm baseline with one worker, 547 MiB with eight workers, and 667 MiB after heavy generation with one worker. A prior eight-worker process reached approximately 4.2 GiB while idle. Memory management must therefore address both reachable cache data and worker allocator high-water without changing voxel payload semantics.

## Goals / Non-Goals

**Goals:**

- Bound retained voxel mesh and compression data by bytes while preserving an entry cap as a safety limit.
- Expose enough main-thread and per-isolate memory data to identify cache growth and worker high-water behavior.
- Bound worker-local represented-emitter data and reclaim expanded worker isolates through safe recycling.
- Bound both prepared and resolved emitter-summary retention in the main isolate.
- Reduce the largest redundant generation allocations while preserving byte-for-byte compatible voxel payloads.
- Keep configuration optional, validated, and safe when values are missing or malformed.
- Make real-save memory comparisons repeatable across worker counts and cache states.

**Non-Goals:**

- Changing voxel geometry, lighting, emitter aggregation, compression negotiation, or the HTTP binary contract.
- Guaranteeing an exact process RSS ceiling; Node.js, native compression, and the operating-system allocator remain involved.
- Replacing the worker pool or region parser architecture wholesale.
- Adding client-side memory controls.

## Decisions

### Use weighted eviction for mesh buffers

The mesh LRU will track the byte length of each distinct retained backing buffer: raw payload, gzip variant, and Brotli variant. It will evict least-recently-used entries until both the configured byte budget and existing entry limit are satisfied. Identity references that share the raw backing store count once. Replacing or adding a compression variant updates the entry weight and can trigger eviction.

The existing `VOXEL_MEMORY_CACHE_SIZE` remains as an entry safety cap for compatibility. A validated byte-budget setting becomes the primary memory control. Invalid, zero, or negative values fall back to documented defaults rather than disabling eviction.

Alternatives considered: estimating a fixed size per entry cannot represent model-heavy meshes; retaining only compressed data increases regeneration or decompression complexity; removing the memory cache would impose avoidable latency.

### Separate in-flight emitter work from resolved worker cache data

Represented-emitter source generation will retain promises only while work is in flight. Resolved source arrays will move into a small LRU governed by entry and aggregate source-count limits, with metrics for both. The initial bounds will be conservative and configurable so benchmarks can determine whether reuse justifies higher retention.

Alternatives considered: moving the cache to the main isolate would add structured-clone traffic and broaden the worker protocol; disabling it entirely is useful diagnostically but can repeat expensive neighbor work.

### Report isolate memory and recycle only idle workers

Each successful or failed worker result will include `heapUsed`, `heapTotal`, `external`, and `arrayBuffers`, plus worker-cache cardinality. Process RSS is not treated as a per-worker value because worker threads share a process. The pool will mark a worker for retirement when configured isolate-memory or completed-job thresholds are exceeded. A marked worker finishes its current job, receives no new work, terminates while idle, and is replaced before pool capacity is restored.

At most one routine retirement occurs at a time. Worker errors continue to use immediate replacement. Recycling thresholds can be disabled, allowing operators to choose reuse over deterministic reclamation.

Alternatives considered: forcing garbage collection requires unsupported runtime flags and still does not guarantee native memory release; recycling every job maximizes reclamation but discards caches and startup work too aggressively.

### Remove full summaries from request handoff state

`getCurrentEtag` will not place complete emitter-summary graphs in an unbounded handoff map. Summary reuse will rely on the bounded emitter-summary service cache, or on a narrowly bounded preparation cache keyed by source signature and epoch if measurement proves rebuilding material. Invalidation and global clearing remove any prepared state. Cold summary leaf generation will remain bounded, with its concurrency shared with the validated `VOXEL_WORKERS` worker-pool limit rather than fixed at one.

Alternatives considered: a timeout alone still permits bursts to retain many summaries and leaves stale-key concerns.

### Budget resolved emitter-summary nodes in the main isolate

The emitter-summary service currently keeps up to 512 fully materialized nodes in an entry-count-only LRU. A node includes a cluster object graph whose size varies with source density, so that limit can retain far more memory than the mesh-cache byte budget and is not visible through service metrics. The summary cache will retain both its entry cap and a validated aggregate weight limit. Its weight will be the UTF-8 byte length of the serialized node representation that is already produced while calculating the node signature. This is a repeatable conservative accounting unit rather than a claim about exact V8 heap residency.

The cache will use weighted LRU eviction, decline nodes larger than its complete budget, and report entry count, estimated retained bytes, retained cluster count, evictions, and oversized skips. New summary-cache environment controls will have documented positive defaults, and malformed or non-positive values will fall back safely. Invalidation will advance an epoch or otherwise identify obsolete work so a node built before per-key or global invalidation cannot be retained when it eventually resolves.

Alternatives considered: relying on V8 heap statistics cannot identify the responsible summary key and is not stable enough for eviction; serializing and retaining compact summary bytes would change normal generation access patterns and add decode churn; an entry limit alone cannot bound dense node graphs.

### Add a repeatable real-save cold/warm memory harness

The existing Node benchmarks use hermetic fixtures and report timing and structural metrics, which is appropriate for correctness but cannot reproduce allocator or real-save summary retention. A separate opt-in harness will start a dedicated server for each configured worker count against an explicitly supplied real save and Cubyz asset root. It will place all persistent voxel and summary cache files in a fresh temporary `VOXEL_CACHE_DIR`, leaving the save untouched.

The harness will accept a checked-in request manifest and fixed workload configuration, wait for server readiness, and run the same bounded-concurrency request set in two phases: cold against an empty temporary cache root, then warm against the retained in-memory and persistent state from that cold phase. It will sample server-process RSS from startup through each phase and a fixed idle interval, drain compressed response bodies, and capture `/api/voxels/metrics` before and after every phase. Results will include Node/runtime mode, save identity, worker/recycling/cache configuration, manifest, request outcomes, RSS startup/peak/post-work/post-idle values, and cache/worker/summary metrics in machine-readable JSON plus a concise human-readable table.

The default comparison will execute the same manifest with one and eight workers. It must record the exact settings and cache state rather than treating a warm single-worker run and cold eight-worker run as comparable. The harness is observational, not a release threshold: it detects unexplained retained memory and makes a subsequent tuning decision reproducible.

Alternatives considered: manually driving `curl` leaves cache state, request concurrency, and RSS sampling inconsistent; adding these measurements to hermetic correctness tests would make the suite machine-dependent; using the normal project cache directory risks mutating developer state and contaminating a later run.

### Reduce encoder allocation overlap without changing its wire format

The encoder will preserve greedy and model ordering from generation, compute exact section sizes, allocate the final output once, and write records directly into their final sections. It will avoid the combined quad-array copy, sorting, and universal model-vertex scratch arrays. Existing contract tests will compare output semantics and decoded records across representative meshes.

Persistent mesh writes will use vectored or sequential writes so the complete payload is not copied through `Buffer.concat`. These changes target peak memory and allocator high-water rather than cache retention.

Alternatives considered: retaining the structure-of-arrays staging encoder is simpler but preserves the largest avoidable typed-array overlap; changing the binary layout could improve locality but would be a breaking client/server contract change.

### Stage high-risk allocation work after retention controls

Implementation proceeds in two stages. The first stage adds metrics, bounded caches, prepared-summary cleanup, and worker recycling. The second stage removes encoder and persistent-write copies. This allows memory experiments after each stage and keeps regressions attributable.

## Risks / Trade-offs

- [Lower cache budgets increase generation and compression work] -> Keep limits configurable, expose hit/eviction/byte metrics, and benchmark representative navigation workloads.
- [Worker recycling causes temporary throughput loss] -> Retire only idle workers, one at a time, and replace before dispatching queued work to the new slot.
- [Reported external memory may not map exactly to reclaimable RSS] -> Use isolate metrics as policy signals and validate outcomes with process RSS/PSS experiments.
- [Summary serialized bytes differ from V8 object residency] -> Label the summary budget and metric as an estimated retained weight, retain the entry cap, and correlate it with process RSS through the controlled harness.
- [Direct encoding can introduce binary-layout regressions] -> Preserve the current layout constants and extend server/client/contract voxel tests before replacing staging arrays.
- [Emitter-cache reductions can repeat expensive recursive work] -> Keep in-flight deduplication independent from resolved-value eviction and measure cache hit rates.
- [A higher worker limit can overlap more main-isolate cold-summary builds] -> Use the shared validated `VOXEL_WORKERS` bound, document the throughput/memory trade-off, and retain `VOXEL_WORKERS=1` as the conservative setting.
- [A single mesh can exceed the configured byte budget] -> Allow it to serve the active request but do not retain an entry whose weight exceeds the total budget.
- [Recycling loses worker-local diagnostics and caches] -> Include retirement counters and reasons in metrics so operational cost is visible.
- [A real-save workload can be non-representative or alter user data] -> Require an explicit request manifest and save path, use only a temporary project cache root, and record the full configuration with every result.

## Migration Plan

1. Add validated configuration and diagnostics while preserving current cache and worker behavior by default during development.
2. Enable byte-budgeted cache eviction, bounded worker emitter caching, prepared-summary cleanup, and bounded cold-summary generation with documented defaults.
3. Add byte-budgeted resolved emitter-summary retention and diagnostics, including stale in-flight completion protection.
4. Add the controlled real-save cold/warm harness, establish the workload manifest, and compare one-worker/eight-worker configurations using equivalent cache states.
5. Enable conservative worker recycling thresholds and tune cache defaults using the recorded workload data.
6. Land direct encoding and persistent-write allocation reductions after binary contract tests pass.
7. Update architecture and server operations documentation before release.

Rollback is configuration-first: disable recycling and raise byte/source budgets without reverting the binary-compatible implementation. The existing entry cap remains available throughout migration.

## Open Questions

- Which byte budget and isolate-memory recycling thresholds provide the best defaults across typical machines?
- Should compressed variants share one budget with raw meshes or use a smaller dedicated sub-budget?
- Does represented-emitter cache reuse justify retaining more than a small number of resolved columns per worker?
- Which summary-cache estimated-byte and entry defaults preserve common coarse-summary reuse without repeating the multi-gigabyte idle RSS observed in the cold eight-worker pilot?
- Which checked-in request manifest best represents a dense, production-like save while remaining practical for a local controlled comparison?
