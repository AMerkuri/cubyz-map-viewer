## Context

The browser currently prioritizes every coverage request ahead of every detail request, admits one mesh job at a time, emits one complete base-plus-emissive worker result, and inserts expanded results FIFO. This protects fallback coverage but allows continuously arriving rear or distant coverage to starve focus LOD 1 detail. Existing cumulative averages confirm long waits but do not identify current oldest work or provide comparable per-load distributions.

The compact HTTP payload and server path are already fast and cacheable. Client decode expands a typical response to several megabytes, and emissive baking can dominate worker execution. Loaded stale voxel geometry already remains visible until a refresh replacement is ready; that behavior is a correctness and user-experience constraint.

Live terrain-update messages already arrive as batches, but client scene handling processes each source coordinate separately. Overlapping halo footprints can therefore increment one key's refresh version and cancel or restart its work repeatedly. Client coarse-LOD halo expansion also differs from server invalidation expansion.

## Goals / Non-Goals

**Goals:**

- Bound the wait of continuously demanded focus detail without delaying genuine visible-hole coverage.
- Make base voxel geometry visible before optional emissive enhancement when enhancement dominates worker cost.
- Use a small adaptive browser worker pool without turning expanded output, scene insertion, or memory into the next unbounded bottleneck.
- Apply each live-update batch once per affected voxel key and preserve stale visible geometry until a current replacement is ready.
- Provide load-generation and current-queue diagnostics that can prove starvation, deadline behavior, utilization, and downstream health.
- Preserve deterministic, hermetically testable scheduling and invalidation mechanics.

**Non-Goals:**

- Persist expanded meshes across browser refreshes.
- Change the `/api/voxels` payload, route, compression, or ETag contract.
- Change WebSocket event names or payloads.
- Dynamically resize the server voxel worker pool.
- Make terrain scene refreshes stale-while-revalidate.
- Guarantee a wall-clock focus deadline when the browser is suspended, the device is overloaded, or one non-preemptible operation itself exceeds the deadline.

## Decisions

### Use safety bands plus bounded continuous-demand urgency

Replace the strict `coverageClass` first comparison with ordered safety bands and deadline slack. Work that fills a conservatively screen-visible hole with no loaded fallback remains the highest safety band. Continuously demanded focus base/detail work receives a configurable deadline and can pass non-visible, rear, or speculative coverage as its slack approaches zero. Remaining work is ordered by view relevance, projected benefit, distance, LOD, and stable sequence.

The scheduler will track `demandSince` independently from request creation and selection generation. Reprioritization preserves it while the key remains continuously demanded and resets it when demand disappears or its refresh identity changes. Aging is capped within safety constraints, so old rear enhancement cannot pass a new visible hole.

This retains the coverage invariant while avoiding the current discontinuity where any no-fallback rear request permanently outranks focus detail. Weighted fair queues were considered, but fixed quotas cannot express the difference between a visible hole and conservative rear coverage. A single free-form score was considered, but safety bands make hole prevention easier to reason about and test.

### Carry urgency through every queued client stage

Fetch admission, compact dispatch, and expanded scene insertion will use the latest eligible priority. Active work remains cooperative rather than forcibly preemptive. Base and enhancement phases have distinct priorities; urgent base work always outranks optional enhancement except when no base work is eligible.

Scene insertion remains frame-budgeted and whole-tile atomic, but its queue will select the highest-priority current item rather than unconditional FIFO. This prevents already-expanded peripheral work from creating a second priority inversion.

### Retain point-based focus and fixed motion debounce

Voxel focus remains the existing smoothed point resolved from nearby loaded voxel geometry, a center-screen voxel ray, sticky prior focus, or the controls target. A tile is focus-classified only within the existing half-region local radius. Pointer hover, click/tap coordinates, and a broad central viewport region do not directly influence LOD selection.

Optional detail continues to use the fixed camera/controls-target motion threshold and debounce. A richer pointer/velocity focus region was implemented and rejected because ordinary pointer movement repeatedly changed local refinement, causing fine/coarse tile churn, worker waste, and abrupt visibility transitions.

### Split base and emissive work into independently scheduled phases

The worker protocol will produce a base result without mesh-local emissive attributes, returning ownership of the original compact buffer to the main thread with the transferred base arrays. The base result can enter scene insertion immediately. If emissive enhancement is enabled and relevant emitters exist, the scheduler retains the compact buffer as a separately accounted enhancement input and may dispatch it to any pool worker.

The enhancement phase rebuilds the emitter lookup, traverses compact quads in deterministic output order, and returns only optional per-quadrant emissive arrays. The main thread attaches those attributes to the current base geometry only when job identity, tile refresh version, and base mesh identity still match. Stale loaded geometry is replaced atomically by current base geometry; enhancement enriches that geometry in place without temporarily removing it.

Returning the compact buffer avoids worker affinity and avoids cloning it. Re-traversing compact quads adds some total CPU work, but it separates roughly base-visible latency from the dominant enhancement latency. Retaining compact data inside a specific worker was rejected because it complicates cancellation, worker retirement, memory accounting, and pool dispatch.

### Use a bounded adaptive worker pool with prospective reservations

The pool starts conservatively and never uses `navigator.hardwareConcurrency` directly as its target. Initial profiles are one worker with a maximum of two for coarse-pointer/mobile-class interaction, two workers with a maximum of four for desktop-class interaction, and a maximum of one when an available low-memory signal places the device below a conservative threshold. Unsupported device hints fall back to the conservative profile rather than being required for correctness.

Before dispatch, the scheduler reserves prospective expanded bytes for each active job. Estimates use compact metadata and bounded historical expansion observations by phase and LOD, with an oversized-single-job escape when the stage is otherwise empty. Reservations are reconciled with actual output and released exactly once on result, cancellation, error, or worker termination. Compact buffers retained for enhancement remain charged to compact memory.

The controller uses bounded rolling signals: oldest urgent queue age, worker busy ratio and duration, frame-time p95, expanded scene backlog, reserved/output bytes, active interaction, and available memory indicators. It adds at most one worker after a sustained healthy interval and cooldown, and lowers the target quickly after unhealthy frame, scene, memory, or worker-duration signals. Excess workers retire when idle; scale-down does not discard current valid work.

Static one-worker mode remains a valid fallback and test baseline. The target calculation and reservation mechanics remain pure modules testable without real workers or WebGL.

### Coalesce invalidations before mutating refresh state

The scene subscription will pass a complete received update batch to a pure affected-key expansion function. That function unions surface gutter neighbors, voxel halo neighbors, and required ancestors before any version increments, cancellation, eviction, or refresh request occurs. Each affected voxel key is marked stale exactly once per received batch.

Client and server will derive coarse and LOD 1 halo footprints from aligned shared constants or pure mechanics covered by contract tests. The WebSocket payload remains a list of changed source coordinates; expansion remains local.

For loaded voxel keys, invalidation keeps old geometry visible. A current base result atomically replaces stale geometry, and a later current enhancement may enrich it. Every fetch, cache-independent phase, worker result, and scene operation carries the existing refresh version so obsolete results are discarded.

### Replace cumulative-only diagnostics with bounded distributions and current state

Diagnostics will retain cumulative counters where useful but add a resettable load-generation identifier and bounded per-generation distributions for each pipeline phase. The HUD exposes p50, p95, and max; current oldest queue age by LOD, safety/coverage class, view class, and phase; focus deadline misses; worker target/active/busy state; reserved expanded bytes; and scene insertion backlog.

`requestToVisible` remains selection-to-visibility-state timing and will be labelled accordingly. Base-visible and emissive-enhanced timings are separate. A new load generation begins on scene/world initialization and explicit diagnostics reset, not on every LOD selection generation.

## Risks / Trade-offs

- [Urgency policy delays useful fallback coverage] -> Keep screen-visible no-fallback work in a non-aging safety band and add deterministic starvation/fallback tests.
- [Two-phase meshing increases total CPU and compact retention] -> Measure base-visible improvement and total work, charge retained buffers, and allow the feature to fall back to one-phase behavior if the split is not beneficial.
- [More workers amplify memory and main-thread scene pressure] -> Reserve prospective bytes, scale one worker at a time, gate increases on scene/frame health, and retire quickly when unhealthy.
- [Browser memory and device hints are missing or unreliable] -> Treat them as optional caps, use observed output/frame behavior, and default conservatively.
- [Enhancement races tile refresh or warm-cache movement] -> Require refresh-version and base-identity checks before attribute attachment and dispose rejected arrays exactly once.
- [Priority changes cause queue churn] -> Preserve stable sequence ordering, use deadline hysteresis, and do not preempt active jobs solely for small score changes.
- [Shared invalidation mechanics couple client and server builds] -> Keep the shared module data-only and pure, document the contract, and cover negative coordinates and every supported LOD hermetically.

## Migration Plan

1. Add generation-scoped diagnostics and pure urgency/invalidation mechanics while retaining one worker and one-phase results.
2. Switch queued stage ordering to the safety-band/deadline model and validate fallback coverage and point-focus convergence.
3. Coalesce live invalidations and align halo footprints.
4. Introduce the base/enhancement worker protocol behind a debug fallback to one-phase meshing until correctness and visual tests pass.
5. Generalize worker ownership to a fixed pool of one, then enable bounded profile defaults and adaptive target changes.
6. Update architecture/client documentation and compare the same regression camera under one-phase/one-worker and adaptive two-phase modes.

Rollback can select the static one-worker target and one-phase worker path while preserving the new diagnostics and invalidation union. No persisted data or server API migration is required.

## Open Questions

- What focus-detail deadline provides the best bounded latency without disrupting fallback coverage?
- Can compact section counts provide a sufficiently safe expansion reservation, or is a short worker preflight count necessary for dense model-heavy chunks?
- Does the extra enhancement traversal reduce total throughput enough to justify skipping enhancement for peripheral or short-lived tiles?
- Which optional low-memory threshold is conservative without unnecessarily limiting common mobile devices?
