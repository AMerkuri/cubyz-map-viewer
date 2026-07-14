## ADDED Requirements

### Requirement: Voxel mesh work uses bounded staged admission
The client SHALL represent fetching, compact mesh-ready input, active worker execution, and expanded scene-ready output as distinct voxel loading stages. It SHALL enforce configured job and byte limits on queued compact input and expanded output, and SHALL stop admitting upstream work while a downstream stage lacks capacity.

#### Scenario: Compact input queue reaches its limit
- **WHEN** completed voxel response buffers waiting for worker execution reach the configured job or byte limit
- **THEN** the client MUST stop admitting additional voxel fetch work until compact-input capacity becomes available
- **THEN** already active HTTP requests MAY complete and make the stage temporarily exceed its byte limit because response size was not known at admission

#### Scenario: Expanded output queue reaches its limit
- **WHEN** worker mesh results waiting for scene insertion reach the configured job or byte limit
- **THEN** the client MUST NOT dispatch another compact input to the mesh worker until expanded-output capacity becomes available

#### Scenario: One item exceeds a stage byte limit
- **WHEN** one compact input or expanded output is larger than its complete configured stage byte limit
- **THEN** the client MUST allow that item to progress when the stage is otherwise empty
- **THEN** the client MUST block additional work for that stage until the oversized item drains

#### Scenario: Worker result or error releases capacity
- **WHEN** a mesh job completes, is cancelled, or fails
- **THEN** the scheduler MUST release its active-worker capacity exactly once and continue draining the highest-priority eligible work

### Requirement: Obsolete voxel mesh jobs are cancellable
The client SHALL assign stable job identities to dispatched voxel mesh work and SHALL cancel work that is no longer demanded or whose refresh version has been superseded. The worker SHALL cooperatively observe cancellation during long-running mesh construction and SHALL avoid transferring expanded mesh output for a cancellation observed before final result transfer.

#### Scenario: Queued tile leaves active demand
- **WHEN** a voxel tile leaves active request demand before its compact input is dispatched to the worker
- **THEN** the client MUST remove its queued work without running mesh decode or emissive baking

#### Scenario: Running tile leaves active demand
- **WHEN** a voxel tile leaves active request demand while its mesh job is running
- **THEN** the client MUST send cancellation for that job identity
- **THEN** the worker MUST observe cancellation at a bounded cooperative checkpoint and return a cancellation acknowledgement without expanded mesh arrays

#### Scenario: Refresh version is superseded
- **WHEN** a tile receives a newer refresh version while an older fetch, queued input, worker job, or scene-ready output exists
- **THEN** every older stage MUST become ineligible for scene insertion
- **THEN** queued or running older work MUST be cancelled where cancellation can still avoid work

#### Scenario: Cancellation races final result transfer
- **WHEN** cancellation arrives after the worker has committed to transferring a mesh result
- **THEN** the main thread MUST reject the result using job identity and tile refresh version
- **THEN** scheduler capacity and queued-output accounting MUST still be released exactly once

### Requirement: Coverage work has deterministic priority over optional detail
The client SHALL prioritize voxel work with explicit ordered fields that distinguish coverage necessity, camera-view relevance, projected refinement benefit, distance, LOD, and request generation. Work needed to avoid a visible coverage hole SHALL outrank optional finer detail.

#### Scenario: Coarse coverage competes with fine detail
- **WHEN** required coarse fallback coverage and optional LOD 1 refinement are both eligible for limited fetch or worker capacity
- **THEN** the client MUST process the required coverage work first regardless of the finer detail's LOD number

#### Scenario: Equal coverage classes compete
- **WHEN** two requests have the same coverage necessity
- **THEN** forward-visible work MUST outrank peripheral or rear work
- **THEN** projected refinement benefit and distance MUST deterministically order requests within the same view class

#### Scenario: Priority changes before worker dispatch
- **WHEN** camera motion or a newer LOD selection generation changes the priority of mesh-ready work
- **THEN** the client MUST dispatch according to the latest eligible priority without duplicating the tile's work

### Requirement: Voxel pipeline diagnostics measure complete loading flow
The debug diagnostics SHALL expose current stage counts and bytes, queue delays, cancellation outcomes, and request-to-visible timing sufficient to distinguish network, worker, and scene-insertion bottlenecks. Optional metrics SHALL maintain their own valid sample counts.

#### Scenario: Tile progresses from admission to visibility
- **WHEN** an admitted voxel tile is fetched, meshed, inserted, and selected visible
- **THEN** diagnostics MUST be able to report fetch duration, compact-input queue wait, worker execution, result-transfer wait, scene-ready queue wait, and request-to-visible duration

#### Scenario: Work is cancelled or discarded
- **WHEN** voxel work is cancelled before dispatch, cancelled while running, or discarded after a race
- **THEN** diagnostics MUST increment the corresponding stage and reason without counting the work as successfully visible

#### Scenario: Optional phase metric is absent
- **WHEN** only a subset of benchmark samples contains a metric such as current-generation halo time
- **THEN** its displayed average MUST use only samples that contain that metric
- **THEN** diagnostics MUST expose or retain the metric's independent sample count

### Requirement: Scheduling mechanics are hermetically verifiable
The client SHALL expose deterministic scheduling, priority, cancellation-state, and capacity mechanics that can be verified without a browser worker, WebGL context, running server, real save, or timing-dependent sleeps.

#### Scenario: Synthetic loading burst exceeds capacity
- **WHEN** a test supplies synthetic fetch completions and worker results that exceed configured job and byte limits
- **THEN** the observed transitions MUST remain within the specified limits except for the documented single-item oversize behavior

#### Scenario: Synthetic cancellation races completion
- **WHEN** a test orders cancellation and completion events around the same job identity and refresh version
- **THEN** exactly one terminal transition MUST release capacity and no stale result may become scene-ready
