## ADDED Requirements

### Requirement: Distinct voxel generation has bounded admission
The server SHALL enforce a validated finite limit on queued distinct voxel generation jobs. It SHALL apply same-key and same-version in-flight deduplication before queue admission, and running jobs SHALL remain bounded by worker-pool capacity.

#### Scenario: Distinct work exceeds queue capacity
- **WHEN** a voxel request requires a new distinct generation job while the configured queue is full
- **THEN** the server does not retain the job or its route waiter in a hidden backlog
- **THEN** the route responds with `503 Service Unavailable` and retry guidance

#### Scenario: Consumer joins admitted work
- **WHEN** a request needs the same key and source version as an admitted queued or running operation
- **THEN** it shares the existing complete generation pipeline without consuming another queue entry

#### Scenario: Invalid queue configuration
- **WHEN** the configured voxel queue limit is malformed, zero, or negative
- **THEN** server startup fails with an error identifying the invalid configuration

#### Scenario: Queue configuration is absent
- **WHEN** no explicit voxel queue limit is configured
- **THEN** the server uses a documented finite positive default

### Requirement: Request lifetime controls shared voxel work consumption
The server SHALL associate each voxel response waiter with the HTTP request lifetime and SHALL retain shared work only while at least one active consumer or reusable completion path requires it. Disconnecting one consumer MUST NOT cancel work required by another consumer.

#### Scenario: Last consumer disconnects while queued
- **WHEN** every consumer of a queued voxel operation disconnects before worker dispatch
- **THEN** the operation is removed from the queue and releases its admission capacity without running

#### Scenario: One shared consumer disconnects
- **WHEN** one consumer disconnects while another consumer still awaits the same key and version
- **THEN** the shared operation continues and the remaining consumer can receive the result

#### Scenario: Last consumer disconnects while running
- **WHEN** every consumer disconnects after worker dispatch
- **THEN** the worker MAY finish its active job
- **THEN** the server skips source validation, compression, cache installation, and response processing that are no longer required

#### Scenario: Compatible demand returns before orphan completion
- **WHEN** a new consumer requests the same current key and version before an orphaned running job completes
- **THEN** the consumer MAY rejoin that operation and make its result eligible for normal post-processing

#### Scenario: Invalidation obsoletes queued work
- **WHEN** voxel invalidation supersedes a queued key version
- **THEN** the obsolete operation is removed from the queue and cannot consume worker execution

### Requirement: In-flight sharing covers the complete response pipeline
The server SHALL deduplicate compatible work through generation, source validation, cache installation, and compressed-variant production rather than ending shared ownership when the worker result arrives.

#### Scenario: Concurrent consumers request one cold compressed payload
- **WHEN** multiple consumers request the same uncached key, version, and encoding
- **THEN** they share one generation and one compatible post-processing pipeline

#### Scenario: Consumer arrives during compression
- **WHEN** a compatible request arrives after worker completion but before compression and cache installation complete
- **THEN** it joins the existing operation instead of dispatching duplicate generation or compression

### Requirement: Admission and cancellation are observable
Voxel service metrics SHALL expose the configured queue limit and cumulative admission, rejection, queued-cancellation, running-orphan, and shared-consumer outcomes needed to distinguish overload from generation failure.

#### Scenario: Operator inspects capacity pressure
- **WHEN** an operator reads the voxel metrics endpoint after overload or disconnect activity
- **THEN** the response reports queue capacity and counters for rejected, cancelled, orphaned, and shared operations without changing voxel payload contents
