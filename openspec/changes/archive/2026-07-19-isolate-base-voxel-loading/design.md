## Context

The fixed regression camera now provides three comparable observations: emissive-off base loading completes in 21 seconds with base-visible p95 near 15 seconds; cached progressive loading with one worker completes in 46 seconds with base-visible p95 near 37 seconds; and forcing two workers plus a 256 MiB expanded-output limit completes in 26 seconds with base-visible p95 near 26 seconds. Two workers are active throughout the forced run and final estimated memory is unchanged, but optional enhancement still delays base geometry despite progressive phase separation.

The priority comparator orders a compact base candidate before enhancement, but it cannot see selected requests waiting outside the scheduler, queued or active fetches, or base work awaiting scene visibility. A short empty-compact interval therefore permits a non-preemptible enhancement to start before a base fetch returns. Retained enhancement input also shares the compact job and byte limits used to admit new base fetches, creating a second inversion before worker dispatch.

Adaptive mode starts at one worker when `navigator.deviceMemory` is unavailable. It samples an already aggregated historical worker p95 every frame and compares absolute reservations against the same 96 MiB value used as the stage limit. Long enhancement history or a conservative initial LOD 1 estimate can therefore keep the target at one even after runtime health improves. The memory control intended to test larger limits converts only the current value to MiB while leaving slider bounds and steps in bytes.

## Goals / Non-Goals

**Goals:**

- Make base lifecycle state explicit from requestable selection through first visibility and protect it from optional enhancement admission and dispatch.
- Keep base compact admission available even when many valid enhancement buffers are retained.
- Use all safely available workers for base convergence, then allow enhancements to consume the pool after base settles.
- Let adaptive fallback and desktop profiles reach two workers from healthy runtime evidence without stale-percentile or reservation self-lock.
- Preserve bounded memory, exact-once cancellation/accounting, enhancement target validity, and one-worker correctness.
- Expose selection-to-fetch delay, executable versus non-executable demand, adaptive limiter reasons, and phase-correct output bytes.
- Make byte-backed debug controls usable in MiB and migrate untouched old defaults without overwriting intentional custom settings.

**Non-Goals:**

- Add more than the existing profile maximum of workers or make four workers the default.
- Optimize emissive candidate caching or exact filtering further.
- Reduce the approximately 1.75 GiB retained loaded-scene footprint or add persistent reload caching.
- Change server generation, routes, binary payloads, compression, ETags, WebSocket events, or shaders.
- Guarantee a browser wall-clock target under suspension, thermal throttling, or unavailable hardware resources.

## Decisions

### Represent pre-fetch base demand inside the scheduler lifecycle

Request synchronization will create or update a versioned base lifecycle record when a selected request is currently requestable, before HTTP admission. The record advances through selected, fetch-queued, fetching, compact-input, meshing, expanded-output, inserted, and first-visible milestones. Known-missing, fresh, retry-exhausted, and future retry-deadline states remain observable classifications but do not count as currently executable. Fetch admission transitions the existing record rather than creating a new record at fetch start.

This provides one source for `hasExecutableBaseWork`, selection-to-fetch timing, queue ages, and progress invariants. Keeping selected demand only in `demandIdentities` was rejected because that map currently conflates actual work with known-missing demand. Inferring state from external React refs was rejected because it would duplicate scheduler mechanics and weaken hermetic testing.

The lifecycle remains version-safe: selection reprioritization preserves continuous demand age, refresh supersession creates the newer identity, and terminal/cancelled records release accounting once. A progress-invariant audit will detect any requestable selected key lacking a valid lifecycle state.

### Separate base compact admission from retained enhancement storage

`compact-input` will describe fetched base buffers awaiting workers. `retained-enhancement-input` will remain separately visible and gain independent bounded limits rather than consuming base job slots. Defaults will cover the measured stable-camera population conservatively while remaining finite; retained bytes continue to count in total estimated memory.

When retained enhancement storage reaches its high-water bound during base loading, the scheduler enters explicit pressure relief. It may dispatch enough enhancement to return below a low-water mark, but with two or more workers it preserves at least one worker for arriving base work. A one-worker profile may run one enhancement only when necessary to prevent retained-input deadlock. Incoming returned buffers may use a documented one-item oversize transition while pressure relief starts, analogous to existing oversized-stage progress.

Dropping enhancement buffers was rejected because current valid loaded tiles would remain permanently unenhanced. Retaining every buffer without a bound was rejected because the regression camera alone can retain roughly 190 MiB of compact input. Refetching discarded payloads was rejected for this change because it adds a second client fetch lifecycle and avoidable network work.

### Gate normal enhancement dispatch on whole-pipeline base state

Normal enhancement dispatch requires `hasExecutableBaseWork === false`, not merely the absence of a compact base candidate. While base remains selected, queued, fetching, compact, meshing, expanded, or awaiting first visibility, idle workers stay available for base except for bounded retained-input pressure relief. Once base settles, all available workers may process enhancement by existing priority.

This creates a base-first wave:

```text
selected/fetching/base workers/scene insertion
                    |
                    v
          base lifecycle settles
                    |
                    v
       retained enhancement workers
```

Reserving exactly one permanent base worker was rejected because both workers should accelerate the initial base wave and because a permanent lane would halve enhancement throughput after base settles. Cancelling enhancements whenever base arrives was rejected because cached enhancement is shorter but still expensive enough that repeated restarts waste significant CPU.

### Feed adaptive control event-level observations

Worker-duration history will update once per completed worker event, while frame and scene observations update per sampled frame. The pure controller will derive rolling percentiles internally and will not append the scheduler's historical p95 as a new duration every frame. Queue pressure will use oldest executable urgent base age rather than focus-only demand or non-executable missing keys.

Limiter evaluation will return both the target and a stable reason such as interaction, frame p95, worker p95, scene jobs, scene bytes, reservation capacity, memory pressure, cooldown, insufficient executable demand, or profile maximum. Diagnostics will expose the profile, current target, current limiter, and relevant threshold values.

The fallback profile remains initial one and maximum two. It may scale to two when browser hints are absent but observed demand, frame, worker, scene, and memory state are healthy. Low-memory and explicit static-one profiles remain capped at one.

### Decouple reservation safety from stale worst-case lock-in

Expanded-output estimation will preserve prospective byte accounting and oversized-single-item correctness but distinguish bootstrap estimates from learned phase-and-LOD observations. Learned estimates will use a bounded conservative statistic plus headroom rather than one permanent maximum ratio. Underestimation remains contained by actual-output reconciliation and dispatch blocking after overshoot.

Adaptive health will compare prospective reservations with the configured capacity and current target rather than treating any value above a fixed 96 MiB constant as universally unhealthy. The default expanded-output capacity becomes 256 MiB for normal profiles, matching the validated two-worker run; this is an admission ceiling, not pre-allocation. A one-worker or low-memory profile still limits concurrency and therefore cannot fill the capacity with parallel results.

Retaining 96 MiB as the unchanged default was rejected because the cold bootstrap estimate has already prevented validated two-worker operation. Removing reservations was rejected because expanded LOD 1 results and GPU upload pressure remain substantial.

### Correct display conversion at the slider boundary

Parameter definitions continue storing canonical `min`, `max`, `step`, default, and setting values in bytes. `ParameterRow` converts the current value, bounds, step, and reset display through `toDisplay`; committed display values convert once through `fromDisplay` and clamp against canonical raw bounds. This fixes both byte-backed controls without special-casing their keys.

Graphics settings advance to version 4. Migration replaces the old 96 MiB expanded-output value with 256 MiB only when it equals the untouched version-3 default; intentional custom values remain unchanged. New retained-enhancement limits receive documented defaults.

### Split timing, demand, and output diagnostics by semantic phase

Base records now expose `selectionToFetchStartMs`. Current queue diagnostics count executable records by stage and report missing, retry-delayed, and retry-exhausted demand separately. The two known-missing regression-camera regions will therefore stop appearing as active 47-second base jobs.

Benchmark aggregation records base output bytes when base completes, enhancement bytes when enhancement attaches or completes, and a per-tile combined value without replacing the base value. Progressive base zero-valued emissive metrics remain phase-correct but are not presented as the whole enhancement workload.

### Prove convergence independent of completion order

Hermetic scenarios will replay the same stable selection with one and two workers while varying fetch, worker, cancellation, and scene completion order. The final loaded, missing, retry-delayed, and cancelled identities must match. A stable requestable key without an active or terminal progress state fails the invariant.

The live regression camera will be repeated enough to determine whether the observed 99-versus-100 loaded count is selection timing or a concurrency race. Runtime validation records the selected key set, not only the aggregate count.

## Risks / Trade-offs

- [Retaining enhancements separately raises transient compact memory] -> Keep finite job/byte limits, report peak retained bytes, and use bounded pressure relief.
- [Strict base-first gating delays visible lighting] -> Base geometry is the primary usability target; all workers switch to enhancement immediately after base settles.
- [A retry-delayed base becomes eligible during enhancement] -> Reclassify it as executable at its retry deadline; normal non-preemption applies only to already running enhancement.
- [Two workers increase frame p95] -> Preserve the 24 ms health guard, scale down adaptively, and compare frame and scene backlogs at the regression camera.
- [A 256 MiB ceiling permits a larger temporary backlog] -> Continue prospective jobs/bytes checks and frame-budgeted scene insertion; the limit allocates no memory by itself.
- [Learned reservation statistics underestimate a dense outlier] -> Reconcile actual bytes, block further dispatch after overshoot, and retain the oversized-single-job escape only when no other consumer exists.
- [Settings migration overwrites intentional tuning equal to the old default] -> Limit migration to version-3 values exactly matching the prior default and document the one-time change.
- [Lifecycle refactor introduces cancellation leaks] -> Preserve one terminal owner per phase and add permutation tests for fetch, worker, scene, and refresh races.

## Migration Plan

1. Add pre-fetch lifecycle records, executable-state classification, timing, and progress-invariant tests while retaining current dispatch behavior.
2. Split retained enhancement capacity from base compact admission and add pressure-relief mechanics.
3. Gate enhancement on whole-pipeline base state and verify one-worker plus two-worker deterministic convergence.
4. Refactor adaptive observations and reservation bootstrap behavior, expose limiter reasons, and enable the validated 256 MiB default through version-4 settings migration.
5. Fix generic MiB control conversion and phase-specific benchmark output.
6. Compare emissive-off, cached one-worker, adaptive default, and fixed-two behavior at the stable camera, including selected-key convergence and frame p95.
7. Update architecture and client documentation before enabling the revised defaults.

Rollback can select static one-worker mode, the previous expanded-output limit, and the prior enhancement dispatch policy while retaining the new diagnostics. No server or persisted world-data rollback is needed.

## Open Questions

- What retained-enhancement job and byte defaults cover the representative camera without allowing excessive compact retention on lower-memory browsers?
- Should pressure relief use high/low watermarks or dispatch exactly one enhancement per overflow event?
- After base isolation, does adaptive two-worker frame p95 remain below the health threshold without the fixed-target override?
