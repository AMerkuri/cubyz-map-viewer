## ADDED Requirements

### Requirement: Executable base work has isolated admission and worker capacity
The client SHALL treat requestable selected base demand, queued and active base fetches, compact base input, active base workers, and scene-ready base output as one executable base lifecycle. Retained enhancement input SHALL use separately accounted bounded capacity and MUST NOT consume the configured compact job or byte capacity reserved for base responses. While executable base work exists, every available worker SHALL select eligible base work before optional enhancement; enhancement MAY proceed only when no executable base work remains or when a separately specified pressure-relief policy is required to keep bounded retained enhancement storage progressing without closing base admission.

#### Scenario: Retained enhancement competes with a newly selected base request
- **WHEN** retained enhancement input exists and a requestable base tile is selected but has not started fetching
- **THEN** retained enhancement jobs or bytes MUST NOT prevent the base request from using reserved fetch and compact-input admission
- **THEN** an idle worker MUST remain available for eligible base work before starting optional enhancement

#### Scenario: Base fetch is active while a worker is idle
- **WHEN** an executable base fetch is active and no base compact buffer has completed yet
- **THEN** the client MUST treat the base lifecycle as outstanding rather than inferring that base loading is complete from an instantaneously empty compact queue
- **THEN** optional enhancement MUST NOT start a non-preemptible job that can delay that arriving base result under the normal base-isolation policy

#### Scenario: Retained enhancement storage reaches its bound
- **WHEN** another returned enhancement buffer would exceed separately bounded retained-enhancement capacity
- **THEN** the client MUST preserve base admission and current visible base geometry
- **THEN** it MUST use a bounded, observable pressure-relief or deferred-reacquisition path that preserves eventual enhancement eligibility without hiding the storage overflow

#### Scenario: Selected region is not executable
- **WHEN** selected demand is known missing, permanently retry-exhausted, already fresh, or temporarily ineligible until a future retry deadline
- **THEN** that demand MUST NOT be counted as currently executable base work
- **THEN** it MUST NOT indefinitely block otherwise eligible enhancement

### Requirement: Concurrent base loading converges deterministically
The client SHALL converge the same current demanded base tile set under one-worker, adaptive, and fixed multi-worker execution, independent of fetch and worker completion order. Capacity release, cancellation, and reprioritization races MUST NOT leave a still-requestable demanded tile without queued, active, loaded, known-missing, or retry-delayed state.

#### Scenario: Two workers complete tiles out of order
- **WHEN** two base workers complete demanded tiles in an order different from request priority or dispatch order
- **THEN** every current result MUST enter normal scene readiness and every obsolete result MUST release capacity exactly once
- **THEN** the final loaded and known-missing tile sets MUST match the deterministic one-worker result for the same stable selection

#### Scenario: Demand changes during concurrent completion
- **WHEN** LOD reconciliation removes, replaces, or reprioritizes demand while multiple fetches or workers complete
- **THEN** obsolete work MUST cancel or discard through normal version rules
- **THEN** every remaining requestable demand MUST retain or regain a valid progress state

### Requirement: Memory controls use consistent display units
The web client SHALL present byte-backed voxel memory settings in MiB while preserving bytes in persisted settings and runtime scheduler limits. Slider values, bounds, steps, reset values, displayed labels, and committed values MUST use one consistent conversion boundary.

#### Scenario: Operator selects 256 MiB expanded output
- **WHEN** the operator sets Expanded Output Memory to `256 MiB` through the debug control
- **THEN** the client MUST persist and apply `268435456` bytes
- **THEN** the slider MUST display a valid range in MiB rather than labeling raw byte bounds as MiB

#### Scenario: Existing byte value is loaded
- **WHEN** persisted graphics settings contain `voxelExpandedOutputMaxBytes: 268435456`
- **THEN** the control MUST display `256 MiB` without rewriting the value as MiB bytes a second time

## MODIFIED Requirements

### Requirement: Voxel pipeline diagnostics measure complete loading flow
The debug diagnostics SHALL expose current executable stage counts and bytes, retained enhancement input, reserved bytes, bounded per-load-generation timing distributions, current oldest executable queue ages, worker utilization, adaptive profile and limiter state, scene backlog, cancellation outcomes, focus deadline misses, phase-specific output bytes, base-visible timing, enhancement timing, and selection-to-visible timing sufficient to distinguish pre-fetch admission, network, scheduling, worker, and scene bottlenecks. Optional metrics SHALL maintain their own valid sample counts, and non-executable known-missing or retry-exhausted demand SHALL be reported separately from queued work.

#### Scenario: Tile progresses from selection to base visibility
- **WHEN** a selected voxel tile becomes requestable, is admitted, fetched, base-meshed, inserted, and selected visible
- **THEN** diagnostics MUST report distributions including p50, p95, and maximum for selection-to-fetch-start, fetch duration, compact-input queue wait, base worker execution, result-transfer wait, scene-ready queue wait, and selection-to-base-visible duration

#### Scenario: Visible base receives enhancement
- **WHEN** emissive enhancement is dispatched and attached to a current visible base mesh
- **THEN** diagnostics MUST separately report enhancement queue, execution, transfer, attachment, and selection-to-enhanced timing without adding enhancement time to base-visible latency
- **THEN** benchmark output MUST distinguish base output bytes, enhancement output bytes, and their per-tile combined total rather than replacing one phase with the other

#### Scenario: Operator inspects current starvation
- **WHEN** voxel work is queued or selected demand cannot currently progress
- **THEN** diagnostics MUST expose the current oldest executable age grouped by LOD, safety or coverage class, view class, phase, and pipeline stage
- **THEN** diagnostics MUST report known-missing, retry-delayed, and retry-exhausted demand separately from executable queue counts
- **THEN** diagnostics MUST expose focus deadline misses, active and target workers, selected worker profile, and the current reason preventing scale-up or dispatch

#### Scenario: Load generation resets
- **WHEN** a scene or world load begins or diagnostics are explicitly reset
- **THEN** subsequent distributions MUST be associated with a new load generation and MUST NOT be averaged with prior-generation samples

#### Scenario: Work is cancelled or discarded
- **WHEN** voxel work is cancelled before dispatch, cancelled while running, or discarded after a race
- **THEN** diagnostics MUST increment the corresponding phase and reason without counting the work as successfully visible or enhanced

#### Scenario: Optional phase metric is absent
- **WHEN** only a subset of samples contains an optional metric
- **THEN** its displayed distribution MUST use only samples that contain that metric
- **THEN** diagnostics MUST expose or retain the metric's independent sample count

### Requirement: Client voxel worker concurrency adapts within safe bounds
The client SHALL select worker concurrency within a conservative configured minimum and maximum using sustained executable base demand and bounded rolling raw worker-completion, frame-time, scene-backlog, output-byte, interaction, and available memory signals. It SHALL increase concurrency gradually, reduce its target promptly after unhealthy signals, and retire excess workers only when idle. The controller MUST NOT feed an already aggregated historical percentile back as repeated raw samples, and one conservative oversized reservation MUST NOT permanently prevent a healthy fallback or desktop profile from reaching two workers when prospective total capacity safely permits two representative jobs.

#### Scenario: Settled view has old executable base work and healthy downstream capacity
- **WHEN** executable base age remains high through the scale-up interval while frame-time, scene backlog, prospective reservations, and memory signals remain healthy
- **THEN** the controller MUST be able to increase the worker target by at most one without exceeding the active device profile maximum
- **THEN** a fallback profile caused only by unavailable browser hints MUST remain capable of reaching two workers from runtime evidence

#### Scenario: Historical worker outlier ages out
- **WHEN** an earlier long worker completion is followed by enough healthy raw completions and downstream signals
- **THEN** the controller MUST recover scale-up eligibility without repeatedly resampling the stale historical percentile

#### Scenario: Reservation estimate exceeds one-job budget
- **WHEN** one conservatively estimated job exceeds the normal expanded-output budget but observed output history and configured capacity safely permit bounded progress
- **THEN** oversized-single-job behavior MUST remain correct
- **THEN** reservation health and dispatch logic MUST expose the limiting estimate and MUST NOT silently lock the profile at one worker after representative estimates become available

#### Scenario: Interaction or downstream health worsens
- **WHEN** active interaction, frame-time, scene backlog, output bytes, memory, or raw worker slowdown crosses an unhealthy threshold
- **THEN** the controller MUST reduce or cap its worker target according to the configured profile without waiting for a scale-up interval
- **THEN** running valid jobs MUST be allowed to complete or cancel through normal demand rules rather than being discarded solely to scale down

#### Scenario: Device capability hints are unavailable
- **WHEN** browser hardware or memory hints are absent or unsupported
- **THEN** the controller MUST use a conservative bounded profile and runtime observations rather than assuming maximum concurrency or permanently restricting execution to one worker

#### Scenario: Static single-worker fallback is selected
- **WHEN** configuration or runtime safety selects a maximum of one worker
- **THEN** the complete loading pipeline MUST remain correct and continue using base isolation, priority, cancellation, reservation, and diagnostics mechanics
