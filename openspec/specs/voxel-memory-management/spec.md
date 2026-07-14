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
The voxel worker protocol SHALL report isolate memory usage and worker-cache cardinality after each completed job, and server voxel metrics SHALL expose current or aggregated values without changing the voxel response payload.

#### Scenario: Voxel job completes
- **WHEN** a worker reports a successful or failed voxel job result
- **THEN** the pool records heap, external, ArrayBuffer, completed-job, and worker-cache measurements for diagnostics

#### Scenario: Operator reads voxel metrics
- **WHEN** an operator requests the voxel metrics endpoint
- **THEN** the response includes worker retirement counts and sufficient memory/cache measurements to distinguish mesh retention from worker-isolate growth

### Requirement: Safe worker high-water recycling
The worker pool SHALL support validated, configurable recycling thresholds based on isolate memory and completed-job count. A worker selected for routine recycling SHALL finish its active job, stop accepting new jobs, terminate while idle, and be replaced without losing queued work.

#### Scenario: Worker crosses a recycling threshold
- **WHEN** a worker completes a job and its reported isolate memory or completed-job count exceeds an enabled threshold
- **THEN** the pool retires and replaces that worker before assigning another job to its slot

#### Scenario: Multiple workers cross thresholds together
- **WHEN** more than one worker becomes eligible for routine recycling
- **THEN** the pool limits routine retirements so available generation capacity is not simultaneously removed

#### Scenario: Recycling is disabled
- **WHEN** all recycling thresholds are explicitly disabled using valid configuration
- **THEN** workers remain reusable after jobs and metrics still report their memory state

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
