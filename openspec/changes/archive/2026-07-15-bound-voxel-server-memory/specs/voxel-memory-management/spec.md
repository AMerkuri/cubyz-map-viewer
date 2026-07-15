## MODIFIED Requirements

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
