## Purpose

Define the shared concurrency contract for voxel workers and cold emitter-summary leaf builds.

## Requirements

### Requirement: Shared Voxel Work Concurrency
The server SHALL resolve `VOXEL_WORKERS` once into a positive effective concurrency value and SHALL use that value for both the `VoxelWorkerPool` capacity and the cold LOD 1 emitter-summary leaf-build limit. When `VOXEL_WORKERS` is unset, the server SHALL use the existing hardware-derived voxel worker default. The server MUST reject malformed, zero, or negative `VOXEL_WORKERS` values before starting voxel services.

#### Scenario: Explicit worker limit
- **WHEN** the server starts with `VOXEL_WORKERS=4`
- **THEN** it SHALL create a voxel worker pool with capacity four and configure at most four concurrent cold emitter-summary leaf builds

#### Scenario: Unset worker limit
- **WHEN** the server starts without `VOXEL_WORKERS`
- **THEN** it SHALL use the same hardware-derived default for the worker pool and emitter-summary leaf-build limit

#### Scenario: Invalid worker limit
- **WHEN** the server starts with `VOXEL_WORKERS` set to a malformed, zero, or negative value
- **THEN** startup MUST fail with an error that identifies `VOXEL_WORKERS`

### Requirement: Bounded Cold Summary Leaf Builds
The emitter-summary service SHALL limit only distinct cold LOD 1 leaf builds to its configured concurrency value. Requests for the same summary key MUST continue to share one in-flight result, and completed memory or persistent-cache summary reads MUST NOT consume a leaf-build slot. The service SHALL release each acquired slot after either a successful or failed build and SHALL dispatch queued distinct leaf builds in first-in-first-out order.

#### Scenario: Distinct cold summaries respect the limit
- **WHEN** more distinct uncached LOD 1 summary requests arrive than the configured limit
- **THEN** no more than the configured number of leaf builds SHALL execute concurrently and remaining requests SHALL wait for released capacity

#### Scenario: Duplicate cold summary request
- **WHEN** concurrent callers request the same uncached LOD 1 summary
- **THEN** they SHALL receive the same in-flight build result without consuming additional leaf-build capacity

#### Scenario: Failed summary build frees capacity
- **WHEN** a cold LOD 1 leaf build rejects while other leaf builds are queued
- **THEN** the service SHALL release its slot and dispatch the next queued build

### Requirement: Shared Concurrency Documentation
The server runtime documentation and environment example SHALL state that `VOXEL_WORKERS` limits both voxel worker isolates and concurrent cold emitter-summary leaf builds. The documentation SHALL state that `VOXEL_WORKERS=1` provides the prior one-at-a-time cold-summary behavior and that larger values trade higher fresh-cache throughput for more overlapping main-isolate work.

#### Scenario: Operator configures fresh-cache behavior
- **WHEN** an operator reviews the runtime configuration documentation
- **THEN** they SHALL be able to determine how `VOXEL_WORKERS` affects worker capacity, cold summary concurrency, and the associated throughput and memory trade-off
