## MODIFIED Requirements

### Requirement: Voxel mesh work uses bounded staged admission
The client SHALL represent fetching, compact base input, active worker execution, retained enhancement input, reserved expanded output, and scene-ready output as distinct voxel loading stages. It SHALL enforce configured job and byte limits prospectively on compact input and expanded output, and SHALL stop admitting or dispatching upstream work while a downstream stage lacks capacity. The active worker stage SHALL support a bounded pool while remaining valid with one worker.

#### Scenario: Compact input queue reaches its limit
- **WHEN** completed voxel response buffers waiting for base worker execution reach the configured job or byte limit
- **THEN** the client MUST stop admitting additional voxel fetch work until compact-input capacity becomes available
- **THEN** already active HTTP requests MAY complete and make the stage temporarily exceed its byte limit because response size was not known at admission

#### Scenario: Expanded output capacity is reserved
- **WHEN** a base or enhancement job is eligible for worker dispatch
- **THEN** the scheduler MUST reserve an estimated expanded-output byte cost before starting the job
- **THEN** the scheduler MUST NOT dispatch the job when its prospective reservation would exceed available expanded-output capacity unless the oversized job is the only active or queued expanded-output consumer

#### Scenario: Estimated output differs from actual output
- **WHEN** a worker result reports an actual expanded byte count different from its reservation
- **THEN** the scheduler MUST reconcile the reservation with actual queued output exactly once
- **THEN** subsequent dispatch decisions MUST use the reconciled capacity

#### Scenario: One item exceeds a stage byte limit
- **WHEN** one compact input or expanded output is larger than its complete configured stage byte limit
- **THEN** the client MUST allow that item to progress when the corresponding stage and reservations are otherwise empty
- **THEN** the client MUST block additional work for that stage until the oversized item drains

#### Scenario: Worker result or error releases capacity
- **WHEN** a base or enhancement job completes, is cancelled, fails, or loses its worker
- **THEN** the scheduler MUST release its active-worker and reserved-output capacity exactly once and continue draining the highest-priority eligible work

### Requirement: Obsolete voxel mesh jobs are cancellable
The client SHALL assign stable job and phase identities to dispatched voxel mesh work and SHALL cancel work that is no longer demanded or whose refresh version or base mesh identity has been superseded. Workers SHALL cooperatively observe cancellation during long-running base construction and emissive enhancement and SHALL avoid transferring expanded output for a cancellation observed before final phase transfer.

#### Scenario: Queued tile leaves active demand
- **WHEN** a voxel tile leaves active request demand before its compact base input is dispatched
- **THEN** the client MUST remove its queued base and enhancement work without running mesh decode or emissive baking

#### Scenario: Running tile leaves active demand
- **WHEN** a voxel tile leaves active demand while a base or enhancement job is running
- **THEN** the client MUST send cancellation for that job and phase identity
- **THEN** the worker MUST observe cancellation at a bounded cooperative checkpoint and return a cancellation acknowledgement without the cancelled phase's expanded arrays

#### Scenario: Refresh version is superseded
- **WHEN** a tile receives a newer refresh version while an older fetch, queued input, worker job, scene-ready output, inserted base, or enhancement exists
- **THEN** every older phase MUST become ineligible for scene mutation
- **THEN** queued or running older work MUST be cancelled where cancellation can still avoid work

#### Scenario: Enhancement base identity is superseded
- **WHEN** an enhancement result targets a base mesh that has been replaced, unloaded, or moved out of current refresh identity
- **THEN** the main thread MUST reject and release the enhancement arrays without changing visible geometry

#### Scenario: Cancellation races final result transfer
- **WHEN** cancellation arrives after a worker has committed to transferring a base or enhancement result
- **THEN** the main thread MUST reject the result using job identity, phase identity, tile refresh version, and base identity as applicable
- **THEN** scheduler capacity and queued-output accounting MUST still be released exactly once

### Requirement: Coverage work has deterministic priority over optional detail
The client SHALL prioritize voxel work with explicit safety, continuous-demand urgency, camera-view relevance, phase, projected refinement benefit, distance, LOD, and stable-order fields. Work needed to avoid a conservatively screen-visible coverage hole with no loaded fallback SHALL outrank optional detail and enhancement. Continuously demanded focus base/detail work SHALL receive a bounded configurable deadline that allows it to outrank non-visible or speculative coverage before starvation.

#### Scenario: Visible hole competes with fine detail
- **WHEN** no-fallback coverage intersecting the conservative visible region and optional LOD 1 refinement are both eligible for limited capacity
- **THEN** the client MUST process the visible-hole coverage first

#### Scenario: Focus detail approaches its deadline
- **WHEN** focus base/detail work remains continuously demanded until its configured deadline while only non-visible, rear, or speculative coverage competes with it
- **THEN** the focus work MUST become eligible ahead of that competing coverage
- **THEN** a newer LOD selection generation MUST NOT reset its continuous-demand age

#### Scenario: Focus demand disappears
- **WHEN** a focus request leaves active demand or its refresh identity changes
- **THEN** its continuous-demand age MUST reset rather than transferring urgency to obsolete work

#### Scenario: Equal safety and deadline classes compete
- **WHEN** two requests have the same safety and deadline state
- **THEN** focus and forward work MUST outrank peripheral or rear work
- **THEN** base work MUST outrank optional enhancement work
- **THEN** projected refinement benefit, distance, LOD, and stable sequence MUST deterministically order remaining ties

#### Scenario: Priority changes before queued stage completion
- **WHEN** camera motion, the resolved point focus, or a newer LOD selection generation changes the priority of fetch-ready, mesh-ready, or scene-ready work
- **THEN** each queued stage MUST select according to the latest eligible priority without duplicating the tile's phase work

### Requirement: Voxel pipeline diagnostics measure complete loading flow
The debug diagnostics SHALL expose current stage counts and bytes, reserved bytes, bounded per-load-generation timing distributions, current oldest queue ages, worker utilization, scene backlog, cancellation outcomes, focus deadline misses, base-visible timing, enhancement timing, and selection-to-visible timing sufficient to distinguish network, scheduling, worker, and scene bottlenecks. Optional metrics SHALL maintain their own valid sample counts.

#### Scenario: Tile progresses from admission to base visibility
- **WHEN** an admitted voxel tile is fetched, base-meshed, inserted, and selected visible
- **THEN** diagnostics MUST report distributions including p50, p95, and maximum for fetch duration, compact-input queue wait, base worker execution, result-transfer wait, scene-ready queue wait, and selection-to-base-visible duration

#### Scenario: Visible base receives enhancement
- **WHEN** emissive enhancement is dispatched and attached to a current visible base mesh
- **THEN** diagnostics MUST separately report enhancement queue, execution, transfer, attachment, and selection-to-enhanced timing without adding enhancement time to base-visible latency

#### Scenario: Operator inspects current starvation
- **WHEN** voxel work is queued
- **THEN** diagnostics MUST expose the current oldest continuously demanded age grouped by LOD, safety or coverage class, view class, and phase
- **THEN** diagnostics MUST expose focus deadline misses and active/target worker utilization

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

## ADDED Requirements

### Requirement: Client voxel worker concurrency adapts within safe bounds
The client SHALL select worker concurrency within a conservative configured minimum and maximum using sustained queue demand and bounded rolling worker, frame-time, scene-backlog, output-byte, interaction, and available memory signals. It SHALL increase concurrency gradually, reduce its target promptly after unhealthy signals, and retire excess workers only when idle.

#### Scenario: Settled view has old urgent work and healthy downstream capacity
- **WHEN** urgent queue age remains high through the scale-up interval while frame-time, scene backlog, reserved bytes, and memory signals remain healthy
- **THEN** the controller MAY increase the worker target by at most one without exceeding the active device profile maximum

#### Scenario: Interaction or downstream health worsens
- **WHEN** active interaction, frame-time, scene backlog, output bytes, memory, or worker slowdown crosses an unhealthy threshold
- **THEN** the controller MUST reduce or cap its worker target according to the configured profile without waiting for a scale-up interval
- **THEN** running valid jobs MUST be allowed to complete or cancel through normal demand rules rather than being discarded solely to scale down

#### Scenario: Device capability hints are unavailable
- **WHEN** browser hardware or memory hints are absent or unsupported
- **THEN** the controller MUST use a conservative bounded profile and runtime observations rather than assuming maximum concurrency

#### Scenario: Static single-worker fallback is selected
- **WHEN** configuration or runtime safety selects a maximum of one worker
- **THEN** the complete loading pipeline MUST remain correct and continue using priority, cancellation, reservation, and diagnostics mechanics

### Requirement: Adaptive scheduling mechanics are hermetically verifiable
The client SHALL expose deterministic urgency, continuous-demand age, reservation, worker-target, cancellation, and phase-transition mechanics that can be verified without browser workers, WebGL, a running server, a real save, or timing-dependent sleeps.

#### Scenario: Synthetic work stream sustains coverage arrivals
- **WHEN** a synthetic clock and work stream continuously introduce non-visible coverage while focus detail remains demanded
- **THEN** tests MUST demonstrate service of the focus detail by its configured scheduling deadline without violating visible-hole priority

#### Scenario: Synthetic outputs exceed estimates
- **WHEN** concurrent synthetic jobs produce actual output larger than their reservations
- **THEN** accounting MUST reconcile each job exactly once and prevent further dispatch until capacity becomes available

#### Scenario: Synthetic health signals change worker target
- **WHEN** deterministic rolling health samples transition between healthy and unhealthy states
- **THEN** tests MUST verify scale-up cooldown, profile bounds, prompt target reduction, and idle retirement decisions
