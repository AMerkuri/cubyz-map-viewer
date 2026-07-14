## Context

The client currently separates HTTP concurrency from a single voxel mesh worker but posts every completed response directly to that worker. Browser worker messages then form an implicit, unmeasured input queue. A job that ceases to be active after transfer still completes synchronous decode, emissive baking, and expanded-output transfer before the main thread can reject it. Accepted outputs enter a frame-budgeted scene queue, but output bytes do not stop further worker dispatch.

LOD traversal preserves parent fallback while children load, but fine refinement is selected primarily from distance, focus, and projected size. The default behind-camera multiplier is too small to materially reduce detail outside the useful view. In a representative stationary scene, 20 LOD 1 tiles account for about 816 MB of reported client memory, while each compact 1.8 MB worker input expands to about 10.1 MB before Three.js construction.

This redesign remains inside the client. The voxel HTTP route and binary payload remain unchanged, and the imperative ownership in `World3DView` remains ref-based rather than becoming React render state.

## Goals / Non-Goals

**Goals:**

- Make every stage from HTTP admission through scene insertion explicit and byte bounded.
- Stop queued obsolete work immediately and stop running work at bounded cooperative checkpoints without transferring mesh output.
- Preserve fast coarse coverage while prioritizing forward-visible, high-benefit detail.
- Keep stationary LOD selection deterministic and preserve parent fallback, missing-region behavior, stale refresh, and warm-cache restoration.
- Measure queue wait and request-to-visible latency rather than reporting only fetch plus worker execution.
- Cover scheduling and LOD mechanics with deterministic, browser-free tests.

**Non-Goals:**

- Changing the server voxel payload, compression negotiation, generation, or cache contract.
- Adding a client worker pool in the first implementation.
- Redesigning emissive lighting, compacting GPU attributes, or adding persistent browser storage.
- Enforcing a new global active-voxel memory budget; view-aware refinement reduces demand while existing warm-cache limits remain in force.
- Moving per-frame Three.js state into React state.

## Decisions

### 1. Model voxel loading as an explicit staged scheduler

The client will represent work in these stages:

```text
selected -> fetching -> mesh-ready -> meshing -> scene-ready -> loaded
                |            |           |             |
                +------------+-----------+-------------+-> cancelled
```

The scheduler will own keyed work records containing request generation, refresh version, priority class, timestamps, compact input bytes, and expanded output bytes. Existing maps and refs may remain as storage, but transitions will be centralized so counters and cancellation cannot disagree.

Three independent limits will apply:

- HTTP fetch count remains bounded by `maxConcurrentVoxelFetches`.
- Completed compact inputs waiting for the worker are bounded by configurable job and byte limits.
- Expanded outputs waiting for scene insertion are bounded by configurable job and byte limits.

The one active worker job is counted separately. Dispatch pauses while the scene-ready queue is at its byte or job limit. A single item larger than a byte limit may pass when its stage is otherwise empty, preventing deadlock. Crossing an input limit because response size was unknown stops further fetch admission until capacity returns.

This is preferred over posting all responses directly to the worker because the main thread retains control of priority and cancellation. It is preferred over immediately adding a worker pool because current emissive-heavy jobs already expand memory by roughly 5.6 times and scene insertion is independently bounded.

### 2. Use stable job identities and cooperative worker cancellation

Each mesh dispatch receives a monotonically increasing `jobId` plus the existing tile key and refresh version. The worker protocol will distinguish `mesh`, `cancel`, `mesh-result`, `cancelled`, and `error` messages.

Queued fetch and mesh-ready work is cancelled by removing its work record and aborting HTTP where applicable. For a running job, the main thread sends `cancel(jobId)`. The worker records cancellation and checks it at phase boundaries and during long quad and emissive loops. Long loops will yield to the worker event loop on a time budget so cancel messages can be observed; cancellation throws or returns an internal sentinel that releases partial arrays and emits only a small `cancelled` acknowledgement.

Checks are time-based rather than every element to limit hot-loop overhead. Cancellation is best effort during short non-yielding parse/allocation sections, but the worker must check before allocating final output, before emissive baking phases, and before transferring results. The main thread still validates key/version on every result as the final race guard.

Terminating and recreating the worker was rejected as the default because frequent camera motion could cause worker churn and lose useful queued state. `SharedArrayBuffer` cancellation was rejected because it would require cross-origin isolation headers and a deployment contract change.

### 3. Prioritize coverage before detail with a lexicographic score

Request priority will no longer rely primarily on a large LOD numeric offset. The scheduler will compare an explicit tuple:

```text
coverage class -> view class -> projected refinement benefit -> distance -> LOD -> generation
```

Coverage required to avoid a hole always precedes optional child refinement. Within the same class, tiles intersecting the forward detail region precede peripheral and rear tiles. Larger projected benefit and shorter distance then win. Refresh work for a visible stale tile uses the tile's current coverage/view class rather than an unrelated global priority.

Lexicographic fields are preferred over one weighted number because priority invariants can be tested directly and future tuning cannot accidentally make optional LOD 1 detail outrank missing coarse coverage.

### 4. Apply view awareness only to refinement depth

Root eligibility and coarse fallback remain governed by render distance. View relevance constrains how far traversal refines:

- `focus`: the resolved focus neighborhood keeps existing local fine-detail behavior regardless of camera classification.
- `forward`: a tile whose conservative bounds intersect an expanded camera view cone may refine to the distance/projected-size result.
- `peripheral`: a tile near the expanded cone is limited to at least one level coarser than the otherwise desired LOD.
- `rear`: a tile clearly outside the cone is limited to at least two levels coarser than the otherwise desired LOD.

Loaded bounds are used when available. Unloaded candidates use their horizontal region bounds plus reference surface Z and a conservative size allowance. The cone derives from camera forward direction, vertical FOV, viewport aspect, and a configurable angular margin. It need not be exact render-frustum culling; conservative classification is preferable to missing detail at screen edges.

Separate enter and exit margins provide angular hysteresis. Existing detail debounce and unload grace continue to prevent rapid request/unload churn. When a fine tile becomes peripheral or rear, its selected coarser ancestor becomes visible before the fine tile leaves active residency; normal unload then moves eligible fine resources to the warm cache.

Hard frustum culling was rejected because it can create empty views during fast rotation. Applying view bias to all coverage was rejected for the same reason.

### 5. Record complete stage timing and cancellation diagnostics

Each accepted work record will retain timestamps for selection/admission, fetch start, body completion, worker dispatch, worker start, worker completion, result receipt, scene build completion, and first visibility. Diagnostics will expose current stage counts and bytes, worker queue wait, scene queue wait, request-to-visible time, cancellations by stage/reason, and obsolete output avoided or discarded.

Aggregates with optional samples will maintain independent sum/count pairs. They will not use total benchmark sample count for nullable metrics. Existing fetch/decode metrics remain available for comparison, but `fetch + decode` will not be labeled as complete loading latency.

This instrumentation is part of the design because concurrency limits cannot be tuned safely from idle queue snapshots.

### 6. Isolate pure mechanics for hermetic tests

Priority comparison, stage admission, cancellation state transitions, view classification, and refinement clamping will be pure or dependency-injected modules. Tests will use synthetic tile trees, camera vectors, fake clocks, fake fetch completion, and fake worker acknowledgements. They will not require React, WebGL, a browser worker, a running server, or a Cubyz save.

## Risks / Trade-offs

- [Worker yielding increases total decode time] -> Check cancellation on a time budget, benchmark the enabled path, and keep short phases synchronous.
- [A response can exceed the input byte limit after download] -> Allow one oversized item only when the stage is otherwise empty and stop further fetch admission until it drains.
- [A large scene-ready result can monopolize the output budget] -> Permit one oversized result for progress while retaining the existing per-frame build budget.
- [More aggressive rear coarsening causes visible detail pop during rotation] -> Keep coarse coverage active, use angular hysteresis and unload grace, and restore recent fine tiles from the warm cache.
- [Conservative unloaded bounds misclassify tall geometry] -> Use generous angular extent and preserve focus override; loaded bounds improve subsequent classifications.
- [Cancellation arrives after final transfer begins] -> Keep main-thread key/version validation and count the result as discarded race output.
- [Scheduler state becomes more complex than independent sets/maps] -> Centralize transitions and assert stage exclusivity in hermetic tests and debug builds.
- [Backpressure lowers network utilization] -> Keep fetch, compact-input, worker, and expanded-output limits separate and tune from end-to-visible measurements.

## Migration Plan

1. Add pure priority, view-classification, and scheduler-state mechanics with tests while preserving current runtime behavior.
2. Introduce job IDs and typed worker message variants; keep cancellation acknowledgements optional until the worker path is converted.
3. Route completed fetches through the bounded mesh-ready queue and gate worker dispatch on scene-ready capacity.
4. Convert long worker phases to cooperative checkpoints and enable active-job cancellation.
5. Enable view-aware refinement with conservative defaults and existing fallback, debounce, hysteresis, and warm-cache behavior.
6. Add stage diagnostics and correct optional-metric aggregation.
7. Update architecture and client documentation, then verify tests, Biome, Knip, type checking, and the production worker build.

Rollback consists of disabling view refinement bias and using limits large enough to reproduce prior admission behavior. The typed protocol and centralized scheduler can remain because they preserve payload and server contracts.

## Open Questions

- What default compact-input and expanded-output byte limits give the best results on representative desktop and mobile-class devices?
- Should the cancellation yield budget be fixed, derived from the frame-rate target, or exposed only as a diagnostic setting?
- Should first visibility be recorded when a tile is attached and marked visible or after the next rendered frame confirms presentation?
