# Voxel Benchmark Cache Timing Specification

## Purpose

Define how voxel benchmark diagnostics report halo timing and cache classification so cold generation and warm cache serving costs can be interpreted separately.

## Requirements

### Requirement: Server halo timing uses request-comparable milliseconds
The voxel benchmark SHALL report server halo timing in milliseconds using the same unit family and comparable scope as server voxel run timing.

#### Scenario: Generated payload includes halo timing
- **WHEN** the server generates a voxel payload that includes neighboring-region halo emitter work
- **THEN** the reported halo time is the elapsed milliseconds spent on halo emitter work for that generation and is not larger than total generation run time except for normal measurement rounding

#### Scenario: Generated payload skips halo timing
- **WHEN** the server generates a voxel payload with halo emitter collection disabled by diagnostics
- **THEN** the reported halo time is zero or explicitly absent rather than a stale value from another payload mode

#### Scenario: Cached payload is served
- **WHEN** the server serves a voxel payload from cache
- **THEN** any reported halo generation timing is identifiable as cached-generation metadata or omitted from current-request timing so it is not mistaken for halo work performed during the cache-hit request

### Requirement: Voxel benchmark reports cache classification
The voxel benchmark SHALL classify benchmarked voxel samples by cache outcome so cold generation and warm cache serving can be interpreted separately.

#### Scenario: Worker-generated response is benchmarked
- **WHEN** a voxel sample is produced from server-side generation work
- **THEN** the benchmark records the sample as a cache miss or cold generation sample

#### Scenario: Cached response is benchmarked
- **WHEN** a voxel sample is served from an in-memory or persistent voxel cache and decoded by the client
- **THEN** the benchmark records the sample as a cache hit or warm cache sample

#### Scenario: Cache classification is unavailable
- **WHEN** a benchmarked voxel response lacks cache classification metadata
- **THEN** the benchmark records the sample as unknown rather than counting it as a hit or miss

### Requirement: Diagnostic benchmark display separates cache state
The debug stats UI SHALL expose cache-hit/cache-miss information for voxel benchmark samples so diagnostic matrix cells can be compared with equivalent cache state.

#### Scenario: Matrix cell has mixed cache states
- **WHEN** a diagnostic matrix cell contains both cache-hit and cache-miss benchmark samples
- **THEN** the debug stats UI displays the hit and miss counts alongside the existing averages or separates cold and warm averages

#### Scenario: Matrix state changes
- **WHEN** the active voxel-lighting diagnostic matrix state changes
- **THEN** cache-hit and cache-miss benchmark counters reset or are separated together with the other benchmark averages for the new matrix state

#### Scenario: Cold and warm runs are compared
- **WHEN** a user runs the same diagnostic matrix cell once cold and once warm
- **THEN** the benchmark output provides enough cache classification data to tell which run represents generation cost and which run represents cache serving cost
