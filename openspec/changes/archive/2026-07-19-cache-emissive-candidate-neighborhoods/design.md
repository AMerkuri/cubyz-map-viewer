## Context

The client worker currently restores seam-correct candidate discovery by probing the complete `3 x 3 x 3` emitter-grid neighborhood in `accumulateEmitterLight` for every evaluated vertex. A representative payload evaluates about 31,537 quads, so four vertices per quad produce roughly 3.4 million cell probes before bucket scans and exact candidate filtering. The live regression camera completes base geometry in about 21 seconds with emissive attributes disabled but requires about 107 seconds with emissive enabled; one-phase diagnostics attribute about 898 of 965 average decode milliseconds to emissive baking.

Receiver-cell neighborhood membership is invariant for the lifetime of one decoded payload: every vertex whose floored world position maps to the same emitter-grid cell probes the same 27 buckets against the same immutable emitter grid. Exact contribution remains vertex-specific because radius, open-face transmission, distance ordering, normal, and falloff depend on the receiver. The optimization must therefore cache only discovery, not final light values or eligibility decisions.

The current Y-axis seam regression and existing X-axis, halo, dense-emitter, coarse-LOD, compact-normalization, and candidate-order tests define the visual baseline. The server payload and shader contracts are unchanged.

## Goals / Non-Goals

**Goals:**

- Reuse each receiver cell's deduplicated fixed-neighborhood emitter-index union across all vertices that map to that cell.
- Preserve byte-identical compact emissive arrays and all existing deterministic seam, radius, direction, ordering, falloff, and output semantics.
- Bound and account cache storage per worker job, with a correctness-preserving uncached fallback after the bound is reached.
- Measure cache hits, misses, cell probes, bucket scans, deduplicated entries, receiver evaluations, cache entries, and peak cache bytes in both one-phase and progressive enhancement diagnostics.
- Compare cached and uncached execution serially on representative payloads and enable caching by default only if the specification's performance and memory gate passes.

**Non-Goals:**

- Change base-versus-enhancement scheduling, worker-pool adaptation, output reservations, or base-work isolation.
- Replace the full progressive enhancement mesh traversal with a compact receiver worklist.
- Change emitter-grid cell size, influence radius, candidate cap, source qualification, halo collection, or server cache identity.
- Persist candidate neighborhoods across worker jobs or browser reloads.
- Cache final light values by vertex position and normal.

## Decisions

### Cache immutable candidate unions by numeric receiver-cell identity

The worker will derive receiver coordinates with the same floor operation used by the uncached path. A job-local cache maps the collision-free numeric receiver-cell identity to an immutable emitter-index sequence or an explicit empty sentinel. On a miss, the worker scans the same 27 cells in the same fixed order, deduplicates with the existing generation-stamp storage, records discovery metrics, freezes the resulting index sequence into cache-owned storage, and then runs existing exact per-vertex filtering. On a hit, it skips cell and bucket discovery and runs the same filtering over the cached sequence.

Dense emitter grids may use a receiver-cache array aligned with an expanded local dense extent when doing so remains within the byte bound. Sparse or out-of-dense-range receiver cells use the existing collision-free numeric coordinate key in a `Map`. The implementation should choose the smallest representation that preserves exact key identity; it must not use string coordinate keys in the hot path.

Caching final selected candidates was rejected because selection depends on exact vertex position and open-face direction. Caching final RGB contribution was rejected because normal and receiving-surface semantics vary. Caching the raw 27 bucket references was rejected because every hit would still repeat deduplication.

### Preserve the uncached algorithm as an explicit execution mode

Candidate discovery will have cached and uncached modes sharing one exact filtering and contribution function. Tests and benchmark tooling can execute the same payload in both modes without changing server payloads or fixtures. Production selection remains uncached until recorded comparisons satisfy the decision gate; if the gate passes, cached mode becomes the default while uncached mode remains available to tests and bounded-cache fallback.

Maintaining two complete bake implementations was rejected because they could drift semantically. Only neighborhood acquisition differs; radius rejection, direction transmission, nearest-candidate insertion, accumulation order, and compact encoding remain one code path.

### Use prospective, conservative per-job cache accounting

Each cache entry accounts its emitter-index storage plus a conservative fixed entry overhead. Cache insertion occurs only when the prospective total remains at or below 16 MiB. When an entry would exceed the bound, that receiver cell uses uncached discovery for the current and later evaluations unless a bounded no-cache marker can be stored without violating the limit. The cache is released with the worker job result, cancellation, or error and is never retained with progressive compact input.

An unbounded `Map<number, number[]>` was rejected because dense LOD 1 payloads could trade CPU improvement for uncontrolled worker-heap growth. General LRU eviction was rejected initially because job-local receiver traversal is finite and eviction bookkeeping can erase the hot-path benefit. A hard insertion stop with uncached fallback is simpler and correctness-neutral.

### Instrument discovery separately from final candidate contribution

The emissive phase metrics will add receiver evaluations, cache hits and misses, neighborhood cell probes, non-empty buckets, raw bucket entries scanned, unique neighborhood entries retained, cache entry count, peak accounted cache bytes, and uncached fallbacks. Existing `candidateVisits` remains the number of final selected candidates whose contribution is accumulated; its meaning will be documented rather than repurposed.

Progressive enhancement results will carry emissive phase metrics and output bytes into enhancement-specific benchmark aggregation. Base-phase zero metrics will remain valid for base execution but will no longer masquerade as the complete progressive emissive workload.

### Compare repeated serial samples and require exact output parity

The comparison harness will warm code paths, then alternate or otherwise balance cached and uncached serial runs to reduce thermal and ordering bias. It will cover at least sparse and dense LOD 1 payloads, own-only and halo-bearing inputs, supported coarse LOD representatives, the asymmetric Y-axis seam fixture, the existing X-axis seam fixture, empty/no-emitter payloads, and a cache-bound stress payload.

For every paired run, quadrant emissive typed arrays must be byte-identical, including presence or absence. Geometry and decoded emitter metadata must remain equivalent. The report records per-fixture median and p95 bake time, aggregate bake time, probe reduction, cache hit ratio, peak cache bytes, and parity outcome. Cached mode becomes the production default only after all normative thresholds pass.

Mean-only comparison was rejected because the observed workload has 5 to 18 second tail jobs. Browser-only measurement was rejected because it is noisy and cannot prove exact array parity, though a final live-camera observation remains useful after hermetic acceptance.

## Risks / Trade-offs

- [Receiver cells have little vertex reuse] -> Record hit ratio per fixture and retain the uncached default when the aggregate performance gate fails.
- [Candidate arrays consume excessive worker memory] -> Enforce prospective 16 MiB accounting and fall back per receiver cell without changing output.
- [Cache representation changes candidate order] -> Share exact filtering and final ordering, compare byte-for-byte arrays, and retain seam contract coverage.
- [Instrumentation distorts benchmark timing] -> Keep counters allocation-free in hot loops and compare both modes with identical instrumentation enabled.
- [Sparse numeric keys exceed their documented coordinate range] -> Reuse only the existing collision-free supported coordinate encoding or introduce a tested collision-free numeric identity for the full supported world range.
- [Progressive metrics require worker-protocol changes] -> Keep additions backward-internal to the client build boundary and run the production build plus worker protocol tests.
- [Caching improves discovery but bake remains too slow] -> Record the result honestly; per-quad discovery, receiver worklists, and base-work isolation remain separate follow-up changes.

## Migration Plan

1. Add discovery counters and an uncached baseline comparison mode without changing production behavior.
2. Add the bounded receiver-cell cache behind the explicit execution mode and prove exact fixture parity.
3. Run repeated representative comparisons and record the report in the change artifacts.
4. Enable cached mode as the production default only if every decision-gate criterion passes; otherwise retain uncached mode and document the failed criterion.
5. Update architecture and client documentation for the selected production path and metric definitions.

Rollback selects the uncached neighborhood provider. No payload, persisted data, cache-key, deployment, or server migration is required.

## Open Questions

- Does a dense receiver-cache array or a numeric sparse map provide the better time-memory trade-off for real LOD 1 payloads under the same 16 MiB bound?
- How much of the remaining bake time lies in repeated exact filtering after neighborhood lookup is cached, and does that evidence justify a later per-quad or receiver-worklist change?
