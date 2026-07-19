## 1. Executable Base Lifecycle

- [x] 1.1 Create versioned scheduler lifecycle state for requestable selected base demand before fetch admission and transition the same identity through fetch-queued, fetching, compact, worker, expanded, inserted, and first-visible milestones.
- [x] 1.2 Classify fresh, known-missing, retry-exhausted, and future retry-deadline demand as non-executable without losing separate diagnostics or future retry eligibility.
- [x] 1.3 Replace fetch-start record creation with lifecycle transitions and derive selection-to-fetch-start timing from the new pre-fetch state.
- [x] 1.4 Add a pure progress invariant that detects any requestable demanded key lacking queued, active, loaded, known-missing, or retry-delayed ownership.
- [x] 1.5 Add hermetic lifecycle tests for reprioritization, continuous-demand age, refresh supersession, retries, missing regions, and exact-once terminal release.

## 2. Base Admission And Enhancement Isolation

- [x] 2.1 Separate base compact-input job and byte accounting from retained-enhancement-input accounting while preserving total memory estimates and transferable ownership.
- [x] 2.2 Select finite retained-enhancement job, byte, high-water, and low-water defaults using the fixed-camera input distribution and conservative lower-memory cases.
- [x] 2.3 Implement base fetch and compact admission that retained enhancements cannot close, including documented one-item oversize progress where required.
- [x] 2.4 Gate normal enhancement dispatch on the absence of executable base work across every lifecycle stage rather than only the compact candidate queue.
- [x] 2.5 Implement bounded enhancement pressure relief that preserves one base-capable worker when at least two are active and prevents one-worker retained-input deadlock.
- [x] 2.6 Add scheduler tests for active-fetch gaps, selected-but-unadmitted base work, full retained storage, pressure relief, one-worker fallback, two-worker base waves, and post-base enhancement drain.

## 3. Adaptive Workers And Reservations

- [x] 3.1 Refactor adaptive observation state so raw worker duration is recorded once per completion while frame, scene, reservation, and interaction signals retain appropriate sampling windows.
- [x] 3.2 Drive scale-up demand from oldest executable urgent base work and exclude known-missing, retry-exhausted, and not-yet-eligible retry demand.
- [x] 3.3 Return and expose stable adaptive limiter reasons for interaction, frame, worker, scene, reservation, memory, cooldown, insufficient demand, and profile maximum.
- [x] 3.4 Replace permanent maximum-ratio output estimation with a bounded conservative learned estimate plus headroom while retaining actual-output reconciliation and oversized-single-item containment.
- [x] 3.5 Compare reservation bootstrap and learned estimates against actual base and enhancement outputs by phase and LOD, including underestimation overshoot and dense LOD 1 outliers.
- [x] 3.6 Set the normal expanded-output default to the validated 256 MiB admission ceiling and prove adaptive desktop and hint-unavailable fallback profiles can reach two workers under healthy synthetic load.
- [x] 3.7 Add pure controller and reservation tests for stale outlier recovery, scale-up cooldown, frame p95 reduction, low-memory/static-one caps, unavailable hints, target-two admission, and output overshoot.

## 4. Settings And Diagnostic Accuracy

- [x] 4.1 Fix generic parameter conversion so displayed slider value, minimum, maximum, step, reset, commit, and clamp use MiB exactly once while persisted settings remain bytes.
- [x] 4.2 Advance graphics settings to version 4, migrate only untouched version-3 expanded-output defaults from 96 MiB to 256 MiB, preserve custom values, and add retained-enhancement defaults.
- [x] 4.3 Add control tests for 1 MiB, 256 MiB, and 1024 MiB boundaries plus version-3 default and custom-value migration.
- [x] 4.4 Report executable queue counts and ages by stage separately from missing, retry-delayed, and retry-exhausted demand so known-missing regions do not appear as active queued jobs.
- [x] 4.5 Split benchmark output accounting into base bytes, enhancement bytes, and combined per-tile bytes and verify progressive aggregation no longer replaces the approximately 10 MiB base output with enhancement-only output.
- [x] 4.6 Extend the debug HUD with selection-to-fetch-start distributions, retained-enhancement capacity, adaptive profile and limiter reason, reservation estimate versus actual output, and phase-specific output bytes.

## 5. Concurrency Correctness And Performance Evidence

- [x] 5.1 Replay identical stable selections with one and two workers under varied fetch, worker, scene, cancellation, and refresh completion orders and require matching loaded, missing, delayed, and cancelled identities.
- [x] 5.2 Add a regression for a demanded tile cancelled or completed during concurrent LOD reconciliation so no requestable key is stranded without progress ownership.
- [ ] 5.3 Extend the deterministic worker comparison with base-first waves, retained-enhancement pressure, adaptive target changes, frame/scene backpressure, and phase-specific memory peaks.
- [ ] 5.4 Repeat the fixed live camera with emissive off, cached static one, adaptive defaults, and fixed two; record base-visible p50/p95/max, full enhancement completion, frame p95, active target, retained input, reservation, transient memory, and selected-key convergence.
- [ ] 5.5 Investigate the observed 99-versus-100 loaded-count run by recording selected keys and prove whether it is valid LOD selection timing or repair a concurrency race before accepting the change.
- [ ] 5.6 Record implementation evidence and selected retained/adaptive defaults in `base-loading-isolation-comparison.md`.

## 6. Documentation And Verification

- [x] 6.1 Update `docs/architecture-overview.md` with pre-fetch base lifecycle ownership, separate enhancement retention, base-wave dispatch, pressure relief, adaptive observations, and reservation recovery.
- [x] 6.2 Update `docs/client-specification.md` with executable-demand semantics, MiB settings and migration, normal and low-memory worker behavior, limiter diagnostics, and phase-specific benchmark definitions.
- [ ] 6.3 Run focused scheduler, request admission, progressive lifecycle, worker pool, adaptive controller, settings migration, diagnostics, live-update, and client benchmark suites and resolve regressions.
- [x] 6.4 Run `npm test && npm run check && npm run check:knip && npm run typecheck`.
- [x] 6.5 Run `npm run build` to verify worker protocol, settings types, and production client bundling.
