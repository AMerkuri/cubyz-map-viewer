## ADDED Requirements

### Requirement: Diagnostics isolate client emissive bake cost
Voxel lighting diagnostics SHALL distinguish client emissive attribute bake cost from fetch time, server generation time, and general worker decode cost.

#### Scenario: Emissive attributes are enabled
- **WHEN** a benchmarked voxel decode runs with emissive attributes enabled
- **THEN** diagnostics report emissive output bytes and available emissive bake phase timings separately from fetch and server generation metrics

#### Scenario: Emissive attributes are disabled
- **WHEN** a benchmarked voxel decode runs with emissive attributes disabled
- **THEN** diagnostics report zero emissive output bytes and show that emissive bake-specific work is not included

### Requirement: Diagnostics support before/after cached-payload comparison
Voxel lighting diagnostics SHALL remain useful for cached-payload benchmarks that compare emissive attributes off and on at the same camera location.

#### Scenario: Server payloads are cache hits
- **WHEN** benchmark samples are served from server voxel cache
- **THEN** diagnostics still report client worker decode, emissive bake, worker output bytes, and emissive bytes so client-side optimization can be evaluated independently of server generation

#### Scenario: Diagnostic matrix state changes
- **WHEN** the emissive attributes diagnostic switch changes between off and on
- **THEN** benchmark samples remain reset or separated by diagnostic state so averages do not mix incompatible modes
