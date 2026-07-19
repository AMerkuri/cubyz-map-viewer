## ADDED Requirements

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
