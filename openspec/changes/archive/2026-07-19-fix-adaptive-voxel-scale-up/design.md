## Context

The applied base-isolation pipeline produces a clear policy comparison at the same stable selection. Adaptive and fixed target `1` both require about 44 seconds and report active/target worker maximum `1`; fixed target `2` completes base loading in about 12 seconds with base-visible p95 near 8 seconds and no focus deadline misses. Fixed targets `3` and `4` still run two workers because the browser uses the hint-unavailable fallback profile whose maximum is two.

The adaptive controller currently receives `getOldestExecutableUrgentBaseAge()`. “Urgent” is the dispatch concept: visible-hole base work or focus base work promoted near its deadline. The short opening coverage wave can complete before both the 1.5-second healthy-demand sustain interval and the 3-second target-change cooldown. Remaining forward, peripheral, and rear base detail is executable and keeps one worker saturated for tens of seconds, but contributes an age of zero to adaptive pressure. The controller therefore reports `insufficient-demand` and behaves exactly like fixed one.

Initialization also sets `lastTargetChangeAt` to the creation time even though no transition occurred. This applies a post-change cooldown to startup. Final diagnostics retain only the current idle limiter, so they cannot show the sequence of earlier demand, health, or cooldown decisions; target observation maximum is presently the only proof that adaptive never scaled.

This change builds on the lifecycle and raw worker-duration mechanics introduced by `isolate-base-voxel-loading`. It does not redesign tile priority, base/enhancement isolation, reservations, or profile maxima.

## Goals / Non-Goals

**Goals:**

- Scale from one to two workers when at least two executable base records remain old enough, the existing worker is saturated, and all health signals are acceptable.
- Count every executable base stage and priority class as concurrency pressure while preserving existing dispatch order.
- Allow the first scale-up after healthy sustain without an artificial post-change startup cooldown.
- Preserve prompt scale-down and cooldown between actual target transitions.
- Retain bounded per-load evidence of maximum target, target transitions, and limiter observations.
- Require deterministic adaptive performance to remain within 25 percent of fixed-two base-visible p95 on a healthy fallback-profile workload.

**Non-Goals:**

- Raise fallback, mobile, low-memory, or desktop profile maximum worker counts.
- Make configured targets `3` or `4` bypass a fallback profile maximum of two.
- Change base tile priority, enhancement gating, retained-input limits, output estimates, or scene insertion budgets.
- Scale up for one isolated optional record that cannot keep another worker useful.
- Remove frame, worker, scene, reservation, interaction, or memory health limits.

## Decisions

### Add a pure executable-base pressure summary

The scheduler will expose one snapshot containing `jobs` and `oldestAgeMs` across non-cancelled base records in executable lifecycle stages. It will include selected, fetch-queued, fetching, compact-input, meshing, expanded-output, inserted-but-not-first-visible, and any other base stage that can still contribute to current base convergence. It excludes non-executable demand and every enhancement record.

The adaptive controller will receive this summary rather than the age of records passing `isUrgentVoxelBaseWork`. Scale-up demand is healthy when:

```text
executable base jobs > current target
oldest executable base age >= pressure threshold
current workers are sufficiently busy
all downstream health checks pass
```

Using `jobs > current target` makes the signal capacity-aware: one remaining record does not request a second worker, while a backlog large enough to occupy another worker does. The existing comparator still selects visible-hole and focus work before lower-priority detail.

Using only compact-ready jobs was rejected because fetch and admission gaps caused the original enhancement inversion. Using only visible-hole or focus age was rejected by the measured adaptive failure. Using all demand identities was rejected because missing and delayed records would create false pressure.

### Preserve continuous pressure across priority-class changes

The summary uses lifecycle `selectedAt` or continuous `demandSince` age independent of current safety and view classes. Reprioritizing a still-executable record does not reset its contribution. Removing demand or changing refresh identity retains existing reset semantics.

This ensures the transition from opening visible-hole coverage to ordinary stable detail does not clear healthy pressure while the same base wave remains backlogged. It does not transfer age between different keys or versions.

### Distinguish initialization from an actual target change

Adaptive state will represent `lastTargetChangeAt` as absent until the controller actually changes target, or equivalently initialize it outside the cooldown window. The first scale-up requires only the healthy-demand sustain interval. Once target changes, the existing cooldown applies before another scale-up. Unhealthy scale-down remains immediate.

Removing the sustain interval was rejected because transient startup bursts should not create workers. Removing cooldown entirely was rejected because desktop profiles can scale beyond two and still need hysteresis.

### Record load-generation decision history without unbounded logs

Adaptive state will maintain bounded counters rather than a per-frame event log:

- Initial, current, and maximum target.
- Scale-up and scale-down transition counts.
- Observation counts by limiter reason.
- First and most recent transition timestamps relative to the load generation.
- Peak executable base jobs and oldest executable base age.

These counters reset with the voxel diagnostics load generation, not only when profile class changes. The HUD continues showing current profile and limiter but adds maximum target and concise transition/limiter summaries. Thus final `insufficient-demand` remains accurate without erasing that target two was reached earlier.

An unbounded timeline was rejected because per-frame sampling would grow indefinitely. Reporting only current limiter was rejected because it cannot diagnose completed loads.

### Compare policies with identical work and explicit acceptance

The deterministic comparison will replay identical selected records, synthetic durations, fetch readiness, scene budgets, and health samples under fixed one, fixed two, and adaptive fallback policies. The healthy workload must keep at least two executable records until adaptive scales, and must include the transition from urgent coverage to ordinary detail before startup cooldown would previously have expired.

Acceptance requires adaptive to reach two, produce no more than one scale-up transition for the fallback profile, retain all health bounds, and achieve base-visible p95 no more than 25 percent slower than fixed two. Separate unhealthy cases prove frame, worker, scene, reservation, interaction, and memory signals still prevent or reverse scale-up.

The established live camera remains observational because browser scheduling varies. It should show target maximum two, no focus misses under healthy conditions, base-visible timing near fixed two, and acceptable frame p95. Fixed one remains the correctness fallback.

## Risks / Trade-offs

- [Low-priority rear detail causes unnecessary scale-up] -> Require executable jobs greater than current target, minimum continuous age, worker saturation, and healthy downstream state.
- [Fetch-queued records inflate pressure while network is the bottleneck] -> Worker saturation remains required; an idle worker waiting only on network will not sustain scale-up eligibility.
- [Lifecycle churn resets backlog before sustain] -> Preserve age for same key/version reprioritization and test visible-hole-to-detail transitions explicitly.
- [Two workers increase frame pressure] -> Keep the existing frame p95 limiter and prompt scale-down; compare live frame p95 against fixed two.
- [Limiter counters overrepresent high frame-rate idle observations] -> Reset per load generation and report counts alongside transitions and peak pressure, not as percentages claiming wall time.
- [Stacked change assumptions drift] -> Implement after the executable lifecycle from `isolate-base-voxel-loading` and add focused integration tests at that boundary.

## Migration Plan

1. Add the pure executable-base pressure summary and tests without changing adaptive inputs.
2. Replace urgent-only adaptive input with jobs and oldest executable age, preserving dispatch priority unchanged.
3. Separate startup state from actual target-change cooldown and add transition tests.
4. Add generation-scoped adaptive decision counters and HUD presentation.
5. Run deterministic fixed-one, fixed-two, adaptive-healthy, and adaptive-unhealthy comparisons.
6. Repeat the live fallback-profile camera and update client and architecture documentation with measured results.

Rollback restores urgent-only pressure and startup cooldown behavior; fixed worker targets remain available throughout. No settings, payload, server, or persisted-data migration is required.

## Open Questions

- Does `jobs > current target` plus the existing 500 ms pressure threshold scale early enough to stay within the 25 percent fixed-two target, or should the healthy workload justify a shorter base-pressure threshold while retaining the 1.5-second sustain interval?
