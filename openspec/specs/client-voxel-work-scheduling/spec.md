## Purpose

Defines bounded, prioritized, cancellable, observable, and hermetically verifiable scheduling for the client voxel loading pipeline.

## Requirements

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

### Requirement: Obsolete voxel mesh jobs are cancellable
The client SHALL assign stable job and phase identities to dispatched voxel mesh work. It SHALL cancel fetch and base work that is no longer under active fetch demand, and SHALL cancel enhancement work when its target loaded base tile is no longer retained or its refresh version or base mesh identity has been superseded. Workers SHALL cooperatively observe cancellation during long-running base construction and emissive enhancement and SHALL avoid transferring expanded output for a cancellation observed before final phase transfer.

#### Scenario: Queued base tile leaves active fetch demand
- **WHEN** a voxel tile leaves active request demand before its compact base input is dispatched
- **THEN** the client MUST remove its queued base work without running mesh decode
- **THEN** the client MUST release associated scheduler capacity exactly once

#### Scenario: Enhancement target remains current after base becomes fresh
- **WHEN** a progressive base tile becomes fresh and therefore leaves active fetch demand while its matching loaded base tile remains retained
- **THEN** the client MUST NOT cancel queued or running enhancement solely because fetch demand ended

#### Scenario: Enhancement target leaves retained lifecycle
- **WHEN** the base tile targeted by queued or running enhancement is unloaded, moved to warm cache, replaced, made stale, or no longer has the scheduled base mesh identity
- **THEN** the client MUST cancel or reject the enhancement without mutating geometry outside the current loaded tile

#### Scenario: Running base tile leaves active fetch demand
- **WHEN** a tile leaves active fetch demand while a base job is running
- **THEN** the client MUST send cancellation for that base job and phase identity
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
- **WHEN** active interaction, frame-time, scene backlog, output bytes, memory, or worker slowdown crosses an unhealthy threshold
- **THEN** the controller MUST reduce or cap its worker target according to the configured profile without waiting for a scale-up interval
- **THEN** running valid jobs MUST be allowed to complete or cancel through normal demand rules rather than being discarded solely to scale down

#### Scenario: Device capability hints are unavailable
- **WHEN** browser hardware or memory hints are absent or unsupported
- **THEN** the controller MUST use a conservative bounded profile and runtime observations rather than assuming maximum concurrency or permanently restricting execution to one worker

#### Scenario: Static single-worker fallback is selected
- **WHEN** configuration or runtime safety selects a maximum of one worker
- **THEN** the complete loading pipeline MUST remain correct and continue using base isolation, priority, cancellation, reservation, and diagnostics mechanics

### Requirement: Adaptive concurrency responds to executable base backlog independently of tile priority
The client adaptive worker controller SHALL derive scale-up pressure from the count and continuous age of all executable base lifecycle records together with current worker saturation. Tile safety, view class, focus deadline, and refinement benefit SHALL continue to order dispatch but MUST NOT exclude an otherwise executable base record from concurrency-pressure accounting. Fresh, known-missing, retry-exhausted, cancelled, enhancement, and future retry-deadline records MUST NOT contribute to base scale-up pressure.

#### Scenario: Ordinary detail remains after visible holes drain
- **WHEN** at least two executable base records remain continuously backlogged beyond the configured pressure age, the current worker remains saturated, and downstream health is acceptable
- **THEN** adaptive mode MUST sustain scale-up eligibility even when those records are optional forward, peripheral, or rear detail rather than visible-hole or deadline-promoted focus work
- **THEN** existing priority rules MUST still determine which record each available worker dispatches first

#### Scenario: Initial urgent wave completes before startup scale-up
- **WHEN** visible-hole base work completes before the controller's startup scale-up interval but a multi-record executable base backlog remains
- **THEN** completion of the urgent subset MUST NOT reset healthy backlog pressure solely because remaining base records have lower scheduling priority

#### Scenario: Only one low-priority base record remains
- **WHEN** fewer executable base records remain than can benefit from another worker and no stronger pressure signal exists
- **THEN** the controller MAY retain its current target rather than scaling solely because one old optional record exists

#### Scenario: Selected demand is non-executable
- **WHEN** selected records are fresh, known missing, retry exhausted, cancelled, or delayed until a future retry deadline
- **THEN** those records MUST NOT increase executable base count or oldest executable base age

### Requirement: Initial adaptive scale-up is not blocked by post-change cooldown
The adaptive controller SHALL distinguish initialization from an actual worker-target transition. A newly initialized fallback or mobile-class controller MAY increase from its initial target after the configured healthy-demand sustain interval without also waiting for a cooldown intended to separate successive target changes. After an actual increase or decrease, the normal target-change cooldown SHALL apply.

#### Scenario: Fallback profile starts with sustained healthy base pressure
- **WHEN** a fallback profile starts at one worker and maintains sufficient executable base count, base age, worker saturation, and healthy downstream signals through the scale-up sustain interval
- **THEN** it MUST become eligible to target two workers without waiting for an additional startup target-change cooldown

#### Scenario: Target recently changed
- **WHEN** the controller has actually increased or decreased its target
- **THEN** it MUST enforce the configured cooldown before another scale-up while retaining prompt unhealthy scale-down behavior

### Requirement: Adaptive decisions remain observable across a load generation
The client SHALL retain bounded per-load-generation adaptive decision diagnostics that distinguish current idle state from earlier scale-up opportunities and blockers. Diagnostics SHALL expose maximum target reached, target transition counts, and limiter observation counts or durations sufficient to explain why adaptive behavior differed from fixed worker modes.

#### Scenario: Load ends after adaptive scale-up
- **WHEN** adaptive mode reaches two workers and later returns to insufficient demand after loading settles
- **THEN** diagnostics MUST still show that target two was reached and record the target transition

#### Scenario: Adaptive target never increases
- **WHEN** a load generation remains at one worker
- **THEN** diagnostics MUST identify whether insufficient executable backlog, worker saturation, startup sustain, cooldown, frame, worker, scene, reservation, memory, interaction, or profile limits prevented scale-up during the generation

### Requirement: Healthy adaptive loading approaches fixed-two base performance
For a deterministic workload whose fallback profile permits two workers and whose frame, worker, scene, reservation, interaction, and memory signals remain within healthy thresholds, adaptive mode SHALL reach target two and SHALL complete base visibility without material avoidable delay relative to fixed target two. The comparison SHALL preserve identical selected work, durations, capacities, and scene budgets across policies.

#### Scenario: Deterministic base wave is healthy
- **WHEN** the same healthy multi-record base wave is replayed under adaptive, fixed-one, and fixed-two policies
- **THEN** adaptive mode MUST transition to two workers
- **THEN** adaptive base-visible p95 MUST be no more than 25 percent slower than fixed-two p95 and MUST be materially faster than fixed-one p95

#### Scenario: Two-worker health becomes unacceptable
- **WHEN** adaptive execution crosses an existing frame, worker, scene, reservation, memory, or interaction threshold
- **THEN** the controller MUST retain normal prompt scale-down behavior even if executable base backlog remains high

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

### Requirement: Scheduling mechanics are hermetically verifiable
The client SHALL expose deterministic scheduling, priority, cancellation-state, and capacity mechanics that can be verified without a browser worker, WebGL context, running server, real save, or timing-dependent sleeps.

#### Scenario: Synthetic loading burst exceeds capacity
- **WHEN** a test supplies synthetic fetch completions and worker results that exceed configured job and byte limits
- **THEN** the observed transitions MUST remain within the specified limits except for the documented single-item oversize behavior

#### Scenario: Synthetic cancellation races completion
- **WHEN** a test orders cancellation and completion events around the same job identity and refresh version
- **THEN** exactly one terminal transition MUST release capacity and no stale result may become scene-ready

### Requirement: Server capacity responses remain retryable demand
The client voxel fetch scheduler SHALL classify `503 Service Unavailable` responses with server retry guidance as temporary admission pressure. It SHALL release the active fetch slot, SHALL NOT consume the tile's permanent generation-failure budget, and SHALL retry only while the tile remains demanded through the normal prioritized scheduler.

#### Scenario: Required coverage receives overload response
- **WHEN** a demanded coverage request receives a server-capacity `503` response
- **THEN** the client releases fetch capacity and keeps the tile eligible for a delayed prioritized retry without counting a permanent failure

#### Scenario: Optional detail leaves demand after overload
- **WHEN** a detail request receives a server-capacity response and leaves active demand before its retry becomes eligible
- **THEN** the client does not retry that obsolete request

#### Scenario: Retry guidance is present
- **WHEN** the server provides a valid `Retry-After` value with a capacity response
- **THEN** the client does not re-admit that tile before the indicated delay and continues scheduling other eligible work

#### Scenario: Non-capacity server error occurs
- **WHEN** a voxel request fails with an error other than the documented temporary capacity response
- **THEN** existing failure accounting and retry limits continue to apply
