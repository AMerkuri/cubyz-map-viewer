## Purpose

TBD - define server-side voxel generation memory-management guarantees.

## Requirements

### Requirement: Byte-bounded voxel mesh retention
The server SHALL enforce a configured aggregate byte budget for raw voxel meshes and their retained compression variants in addition to an entry-count safety cap. Shared backing storage SHALL be counted once, and an individual entry larger than the aggregate budget SHALL be served without remaining cached.

#### Scenario: Cache exceeds its byte budget
- **WHEN** adding or enlarging a cached voxel mesh entry would make retained voxel buffers exceed the configured byte budget
- **THEN** the server evicts least-recently-used entries until retained buffers are within both byte and entry limits

#### Scenario: Oversized mesh is generated
- **WHEN** one generated mesh and its required retained data exceed the complete mesh-cache byte budget
- **THEN** the server serves the request and does not retain that oversized entry after the active operation completes

#### Scenario: Invalid cache configuration
- **WHEN** a mesh-cache limit is missing, non-numeric, zero, or negative
- **THEN** the server applies a documented positive default and does not silently create an unbounded cache

### Requirement: Bounded worker emitter retention
Each voxel worker SHALL separate in-flight represented-emitter computations from resolved cache values and SHALL bound resolved values by configured cardinality limits. Eviction SHALL NOT cancel or duplicate an in-flight computation that still has active consumers.

#### Scenario: Worker emitter cache reaches its limit
- **WHEN** storing a represented-emitter result would exceed an entry or aggregate source-count limit
- **THEN** the worker evicts least-recently-used resolved values until the cache is within all configured limits

#### Scenario: Concurrent requests need the same emitter sources
- **WHEN** multiple active generation operations request the same represented-emitter source key
- **THEN** the worker shares one in-flight computation without requiring the resolved result to remain cached indefinitely

### Requirement: Worker memory diagnostics
The voxel worker protocol SHALL report isolate memory usage and worker-cache cardinality at an idle job boundary after transferable result ownership has passed to the main thread. Server voxel metrics SHALL expose those worker values together with main-process memory usage and SHALL distinguish pre-transfer job measurements from idle retained measurements.

#### Scenario: Voxel job transfers a successful result
- **WHEN** a worker completes and transfers a generated voxel buffer
- **THEN** the pool records a subsequent idle-boundary heap, external, ArrayBuffer, completed-job, and worker-cache measurement that does not count the transferred result as worker-owned memory

#### Scenario: Voxel job fails or returns empty
- **WHEN** a worker completes without a transferable voxel buffer
- **THEN** the pool still records an idle-boundary memory and cache measurement

#### Scenario: Operator reads voxel metrics
- **WHEN** an operator requests the voxel metrics endpoint
- **THEN** the response includes main-process RSS, heap, external, and ArrayBuffer values plus worker retirement counts and idle worker memory/cache measurements sufficient to distinguish mesh retention, main-isolate growth, and worker-isolate growth

### Requirement: Safe worker high-water recycling
The worker pool SHALL enable documented finite routine recycling defaults when recycling configuration is absent and SHALL support validated explicit thresholds based on post-transfer isolate memory and completed-job count. A worker selected for routine recycling SHALL finish its active job, stop accepting new jobs, terminate while idle, and be replaced without losing queued work. An explicit zero value SHALL disable its corresponding threshold.

#### Scenario: Default recycling configuration is used
- **WHEN** the server starts without worker recycling environment values
- **THEN** workers receive documented positive completed-job and memory high-water thresholds

#### Scenario: Worker crosses a recycling threshold
- **WHEN** a worker completes a job and its idle-boundary isolate memory or completed-job count exceeds an enabled threshold
- **THEN** the pool retires and replaces that worker before assigning another job to its slot

#### Scenario: Multiple workers cross thresholds together
- **WHEN** more than one worker becomes eligible for routine recycling
- **THEN** the pool limits routine retirements so available generation capacity is not simultaneously removed

#### Scenario: Recycling is explicitly disabled
- **WHEN** all recycling thresholds are explicitly set to zero
- **THEN** workers remain reusable after jobs and metrics still report their memory state

#### Scenario: Recycling threshold is invalid
- **WHEN** a recycling threshold is malformed or negative
- **THEN** startup fails with an error identifying the invalid configuration instead of silently disabling containment

### Requirement: Prepared emitter summaries do not grow without bound
The server SHALL NOT retain complete prepared emitter-summary graphs in unbounded request handoff state. Any prepared-summary cache SHALL have explicit size and lifetime bounds and SHALL be cleared by relevant voxel invalidation.

#### Scenario: Conditional request returns not modified
- **WHEN** current ETag preparation builds an emitter summary and the voxel route returns `304 Not Modified`
- **THEN** the preparation does not leave an indefinitely retained summary for that request key

#### Scenario: Voxel key is invalidated
- **WHEN** a voxel key or all voxel data is invalidated
- **THEN** prepared summary state associated with the invalidated data is removed or made unreachable

### Requirement: Generation avoids redundant full-payload allocations
Voxel generation SHALL preserve the existing binary payload contract while avoiding redundant full-size quad ordering, encoder staging, and persistent-cache payload copies where final sizes and ordering are already known.

#### Scenario: Mixed greedy and model mesh is encoded
- **WHEN** the server encodes a mesh containing greedy and model quads
- **THEN** it produces contract-compatible sections and records without requiring a sorted copy of the complete quad list or model-vertex staging for greedy quads

#### Scenario: Generated payload is persisted
- **WHEN** the worker writes a generated voxel payload to the persistent cache
- **THEN** it writes metadata and payload without constructing another contiguous copy of the complete payload in memory
