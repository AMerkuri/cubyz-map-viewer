## 1. Executable Base Pressure

- [x] 1.1 Add a pure scheduler summary of executable base job count and oldest continuous base age across selected, fetch, compact, worker, expanded, and pre-visible lifecycle stages.
- [x] 1.2 Exclude enhancement, fresh, known-missing, retry-exhausted, cancelled, and future retry-deadline records from the pressure summary.
- [x] 1.3 Preserve pressure age across same-key/version reprioritization from visible-hole or focus work to ordinary detail and reset it when demand or refresh identity changes.
- [x] 1.4 Add hermetic pressure tests for mixed safety and view classes, stage transitions, missing and delayed demand, cancellation, and a one-record tail.

## 2. Adaptive Scale-Up Semantics

- [x] 2.1 Replace urgent-only age input with executable base jobs and oldest executable age while leaving the existing dispatch comparator unchanged.
- [x] 2.2 Require executable jobs greater than the current target, minimum continuous age, worker saturation, and healthy downstream signals for scale-up pressure.
- [x] 2.3 Represent startup separately from an actual target transition so the first scale-up waits for healthy sustain but not the post-change cooldown.
- [x] 2.4 Preserve cooldown after actual target changes and prompt scale-down for interaction, frame, worker, scene, reservation, and memory limits.
- [x] 2.5 Add pure controller tests for visible-hole-to-detail transition, fallback startup to two, one-record no-scale behavior, reprioritization continuity, real transition cooldown, and every unhealthy limiter.

## 3. Adaptive Decision Diagnostics

- [x] 3.1 Track generation-scoped initial, current, and maximum target plus scale-up and scale-down transition counts.
- [x] 3.2 Track bounded limiter observation counts, peak executable base jobs, peak oldest base age, and first/latest transition times without retaining an unbounded frame log.
- [x] 3.3 Reset adaptive decision history with the voxel diagnostics load generation rather than only when the worker profile changes.
- [x] 3.4 Extend the debug HUD to show maximum target and concise transition/limiter history alongside the current profile and limiter.
- [x] 3.5 Add diagnostics tests proving final idle `insufficient-demand` does not erase an earlier target-two transition or the reason a one-worker load failed to scale.

## 4. Policy Comparison And Acceptance

- [x] 4.1 Extend the deterministic worker-policy comparison with a fallback-profile base wave whose urgent subset drains before the old startup cooldown while ordinary executable detail remains backlogged.
- [x] 4.2 Replay identical work under fixed one, fixed two, adaptive healthy, and adaptive unhealthy policies and record target transitions, base-visible p50/p95/max, frame health, and completion identity.
- [x] 4.3 Tune only the base-pressure threshold or sustain timing if necessary while preserving one-record and unhealthy safeguards, and require adaptive p95 no more than 25 percent slower than fixed two.
- [ ] 4.4 Repeat the established live camera in adaptive, fixed one, and fixed two modes; verify adaptive reaches target two, approaches fixed-two base latency, preserves base selection, and remains within frame and memory safeguards.
- [ ] 4.5 Record deterministic and live evidence in `adaptive-scale-up-comparison.md`.

## 5. Documentation And Verification

- [x] 5.1 Update `docs/architecture-overview.md` to distinguish tile dispatch urgency from executable-base concurrency pressure and document startup versus transition cooldown.
- [x] 5.2 Update `docs/client-specification.md` with fallback-profile scale-up behavior, backlog requirements, health safeguards, and generation-scoped adaptive diagnostics.
- [x] 5.3 Run focused scheduler, adaptive controller, base-lifecycle, worker-policy comparison, and diagnostics suites and resolve regressions.
- [x] 5.4 Run `npm test && npm run check && npm run check:knip && npm run typecheck`.
- [x] 5.5 Run `npm run build` to verify the updated client diagnostics and production bundle.
