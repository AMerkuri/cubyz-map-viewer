## 1. Baseline Discovery Metrics

- [x] 1.1 Extend emissive phase metrics with receiver evaluations, neighborhood cell probes, non-empty buckets, raw bucket entries, deduplicated neighborhood entries, cache hits and misses, cache entries, uncached fallbacks, and peak accounted cache bytes without changing the current uncached output.
- [x] 1.2 Carry one-phase and progressive-enhancement emissive metrics and output bytes through worker result types, benchmark aggregation, and debug diagnostics so progressive base zero values are not presented as the complete emissive workload.
- [x] 1.3 Add hermetic metric tests that distinguish neighborhood discovery from final `candidateVisits` contribution counts and prove disabled emissive baking reports skipped work.

## 2. Bounded Receiver-Cell Cache

- [x] 2.1 Extract candidate-neighborhood acquisition from exact per-vertex filtering and contribution so cached and uncached modes share radius, open-face, ordering, cap, falloff, and accumulation logic.
- [x] 2.2 Implement collision-free numeric receiver-cell identity and immutable deduplicated candidate unions, including an explicit empty entry, without string allocation in the hot path.
- [x] 2.3 Enforce prospective per-job cache accounting with a 16 MiB bound and correctness-preserving uncached fallback when another entry cannot be retained.
- [x] 2.4 Release all receiver-cell cache state on successful completion, cancellation, and error, and keep it out of retained progressive compact-input ownership.
- [x] 2.5 Preserve an explicit uncached execution mode for tests, benchmarks, rollback, and decision-gate comparison.

## 3. Lighting And Lifecycle Correctness

- [x] 3.1 Add paired cached-versus-uncached worker tests requiring byte-identical quadrant emissive arrays, emitter metadata, and non-emissive geometry semantics for sparse, dense, own-only, halo-bearing, empty, and coarse-LOD payloads.
- [x] 3.2 Run cached mode through the existing X-axis and asymmetric Y-axis seam fixtures and require the same normalized seam results as uncached mode.
- [x] 3.3 Add cache-bound stress coverage proving overflow falls back without omitted emitters, changed ordering, job failure, or memory accounting beyond the configured bound.
- [x] 3.4 Add cancellation-checkpoint and progressive-enhancement tests proving cached discovery preserves cooperative cancellation and phase ownership behavior.

## 4. Representative Performance Decision

- [x] 4.1 Extend the serial worker comparison harness with balanced warmup and repeated cached-versus-uncached runs over representative sparse, dense, halo, coarse-LOD, seam, and cache-bound fixtures.
- [x] 4.2 Record per-fixture median and p95 bake time, aggregate bake time, receiver reuse, probe reduction, bucket scans, cache hit ratio, peak cache bytes, and byte-parity outcome in `candidate-neighborhood-comparison.md`.
- [x] 4.3 Evaluate the specification gate: at least 25 percent aggregate bake-time reduction, at least twofold cell-probe reduction, no stable fixture slower by more than 10 percent, byte-identical output, and no more than 16 MiB additional cache storage per worker job.
- [x] 4.4 Enable cached mode as the production default only if every gate passes; otherwise retain uncached mode and document each failed criterion and follow-up evidence.
- [x] 4.5 Observe the selected production mode at the established live regression camera and record worker-duration, base-visible, enhancement, frame-time, and memory results without treating the browser run as the parity proof.

## 5. Documentation And Verification

- [x] 5.1 Update `docs/architecture-overview.md` with the worker-job-local receiver-cell cache, bounded fallback, shared exact filtering path, and progressive metric flow.
- [x] 5.2 Update `docs/client-specification.md` with cache lifecycle, metric definitions, comparison gate, selected production default, and rollback mode.
- [x] 5.3 Run focused client worker, emissive influence, seam contract, progressive pipeline, cancellation, and benchmark comparison suites and resolve regressions.
- [x] 5.4 Run `npm test && npm run check && npm run check:knip && npm run typecheck`.
- [x] 5.5 Run `npm run build` to verify worker protocol additions and production bundling.
