## 1. Scheduling Foundations

- [x] 1.1 Extend voxel work identities and scheduler records with base/enhancement phases, stable sequence, continuous `demandSince`, safety class, reservations, and per-worker ownership while preserving exact-once terminal accounting.
- [x] 1.2 Implement a pure urgency comparator that protects conservatively visible no-fallback holes, promotes continuously demanded focus work by configurable deadline slack, caps aging, and deterministically orders remaining ties.
- [x] 1.3 Preserve continuous-demand age across LOD selection generations and reset it when demand disappears or refresh identity changes.
- [x] 1.4 Apply latest urgency to fetch admission, compact dispatch, and scene-ready selection instead of FIFO expanded insertion, without preempting already-active work for minor priority changes.
- [x] 1.5 Add hermetic scheduler tests for sustained non-visible coverage arrivals, visible-hole protection, deadline service, reprioritization, age reset, scene ordering, and exact-tie stability.

## 2. Generation-Scoped Diagnostics

- [x] 2.1 Add bounded timing distributions with independent sample counts and p50, p95, and maximum values for fetch, compact wait, base worker, transfer, scene wait, and selection-to-base-visible stages.
- [x] 2.2 Introduce a load-generation reset boundary distinct from LOD selection generation and retain cumulative cancellation/discard counters only where they remain useful.
- [x] 2.3 Report current oldest continuous-demand age by LOD, safety or coverage class, view class, and phase together with focus deadline misses and scene backlog.
- [x] 2.4 Add bounded frame-time, worker-busy, worker-duration, reserved-byte, and active/target-worker observations suitable for later adaptive control.
- [x] 2.5 Update debug HUD labels so selection-to-visible semantics, current queue state, and base versus enhancement timings cannot be mistaken for one additive request timeline.
- [x] 2.6 Add hermetic diagnostics tests for generation reset, percentile calculation, optional sample populations, deadline misses, and current oldest-queue grouping.

## 3. Coalesced Live Invalidation

- [x] 3.1 Extract pure voxel invalidation footprint mechanics with aligned LOD 1 and coarse emitter influence constants, floor alignment, and ancestor expansion for every supported LOD.
- [x] 3.2 Add batch expansion and union mechanics that deduplicate source coordinates and affected keys before any refresh version, cancellation, eviction, or direct-refresh side effect.
- [x] 3.3 Change the scene WebSocket subscription path to process each received terrain-update batch once and preserve loaded stale voxel geometry during current-version replacement.
- [x] 3.4 Add client and contract tests for adjacent bursts, duplicate sources, separate batch versions, negative coordinates, every supported LOD, coarse halo neighbors, and exactly-once side effects.

## 4. Point Focus Preservation

- [x] 4.1 Retain the pre-existing smoothed point-based voxel focus and fixed camera-motion debounce after rejecting pointer/tap/central-region LOD refinement due to refinement churn and poor visibility.
- [x] 4.2 Preserve local point-focus classification, scheduler focus deadlines, camera-view hysteresis, fallback coverage, and stationary convergence tests.

## 5. Progressive Base And Emissive Phases

- [x] 5.1 Extend worker protocol types with base request/result and enhancement request/result messages carrying job, phase, refresh, and base mesh identities plus transferable ownership rules.
- [x] 5.2 Refactor optimized worker decoding to produce complete base arrays without emitter-grid construction or emissive baking and return the original compact buffer when enhancement remains eligible.
- [x] 5.3 Implement deterministic enhancement traversal that accepts the returned compact buffer and emits only per-quadrant normalized emissive arrays with existing visual and candidate-order semantics.
- [x] 5.4 Add scheduler transitions and memory accounting for retained enhancement compact input, active enhancement, enhancement reservations, cancellation, errors, and exact-once resource release.
- [x] 5.5 Insert current base geometry atomically, assign a stable base identity, and attach current enhancement attributes in place without removing visible geometry.
- [x] 5.6 Reject and release enhancement output when refresh version, demand, loaded tile, warm-cache lifecycle, or base identity has changed.
- [x] 5.7 Keep a debug one-phase fallback until progressive correctness and representative performance comparisons pass.
- [x] 5.8 Add worker and pipeline tests for base-before-enhancement, urgent-base precedence, no-enhancement cases, compact transfer without cloning, cancellation at both phases, stale attachment races, empty meshes, and normalized attribute attachment.
- [x] 5.9 Extend cached-payload benchmarks to compare base-visible latency, enhancement latency, total CPU, retained compact bytes, and output bytes against the one-phase baseline.

## 6. Byte-Budgeted Adaptive Worker Pool

- [x] 6.1 Generalize scene worker lifecycle from one worker to a bounded pool with worker identities, idle/busy state, error replacement, shutdown cleanup, and static one-worker operation.
- [x] 6.2 Implement prospective expanded-output estimation and reservation by phase and LOD, reconcile actual result bytes, and preserve the documented oversized-single-item escape.
- [x] 6.3 Add conservative device profiles without using `hardwareConcurrency` directly as the target, including one-worker low-memory capping and safe fallback when browser hints are unavailable.
- [x] 6.4 Implement a pure adaptive target controller with bounded rolling queue, frame, worker, scene, byte, memory, and interaction inputs; one-at-a-time cooldown scale-up; prompt scale-down; and idle retirement.
- [x] 6.5 Integrate pool dispatch so every idle worker receives the highest-priority capacity-reserved phase and enhancement cannot block eligible urgent base work.
- [x] 6.6 Add hermetic tests for reservation underestimates, active-output overshoot containment, worker failure, profile bounds, missing hints, scale-up cooldown, prompt target reduction, idle retirement, and one-worker fallback.
- [x] 6.7 Compare fixed 1/2/4-worker and adaptive behavior at the same desktop and mobile-class regression cameras using frame p95, oldest focus age, base-visible p95, scene backlog, expanded bytes, and memory estimates.

## 7. Documentation And Verification

- [x] 7.1 Update `docs/architecture-overview.md` with safety-band scheduling, continuous-demand deadlines, progressive worker phases, pool reservations, scene priority, and coalesced invalidation flow.
- [x] 7.2 Update `docs/client-specification.md` with point-focus semantics, camera-motion debounce, worker profiles, diagnostics definitions, stale-while-revalidate guarantees, and debug fallback controls.
- [x] 7.3 Run focused client, contract, live-update, scheduler, worker-mechanics, and voxel benchmark tests and resolve regressions.
- [x] 7.4 Run `npm test && npm run check && npm run check:knip && npm run typecheck`.
- [x] 7.5 Run `npm run build` to verify browser worker wiring, transferable protocol types, and production output.
- [x] 7.6 Manually validate refresh, stationary point-focus LOD 1 convergence, live-update replacement, diagnostic reset, and adaptive scale-down on desktop and a mobile-class viewport.
