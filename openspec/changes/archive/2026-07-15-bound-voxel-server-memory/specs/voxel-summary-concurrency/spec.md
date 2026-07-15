## MODIFIED Requirements

### Requirement: Shared Voxel Work Concurrency
The server SHALL resolve `VOXEL_WORKERS` once into a positive effective concurrency value and SHALL use that value for both the `VoxelWorkerPool` capacity and the cold LOD 1 emitter-summary leaf-extraction limit. When `VOXEL_WORKERS` is unset, the server SHALL use a documented default of one memory-heavy operation at a time rather than deriving concurrency from available CPU parallelism. The server MUST reject malformed, zero, or negative `VOXEL_WORKERS` values before starting voxel services.

#### Scenario: Explicit worker limit
- **WHEN** the server starts with `VOXEL_WORKERS=4`
- **THEN** it SHALL create a voxel worker pool with capacity four and configure at most four concurrent cold emitter-summary leaf extractions

#### Scenario: Unset worker limit
- **WHEN** the server starts without `VOXEL_WORKERS`
- **THEN** it SHALL create one voxel worker and permit at most one concurrent cold emitter-summary leaf extraction

#### Scenario: Invalid worker limit
- **WHEN** the server starts with `VOXEL_WORKERS` set to a malformed, zero, or negative value
- **THEN** startup MUST fail with an error that identifies `VOXEL_WORKERS`

## ADDED Requirements

### Requirement: Cold summary leaves use lightweight emitter extraction
The emitter-summary service SHALL build an LOD 1 leaf from represented emitter sources without constructing mesh faces, merged geometry, boundary geometry samples, an encoded voxel payload, or a persistent voxel mesh. Extracted sources SHALL preserve the block representation, emitted color, world coordinate, represented-LOD, and open-face semantics used by normal LOD 1 generation.

#### Scenario: Cold populated summary leaf is built
- **WHEN** no valid memory or persistent summary exists for a populated LOD 1 column
- **THEN** the service parses the required voxel source data and clusters lightweight extracted emitter sources without generating a voxel mesh payload

#### Scenario: Summary leaf contains no represented emitters
- **WHEN** a populated LOD 1 column contains no blocks represented as emitted-light sources
- **THEN** the service persists and returns a valid empty summary without constructing geometry

#### Scenario: Summary and normal generation inspect the same source
- **WHEN** summary extraction and normal LOD 1 generation inspect identical source data
- **THEN** represented emitter identity, color, coordinates, represented LODs, and open-face values are behaviorally equivalent before summary clustering

### Requirement: Summary traversal and extraction are observable
The emitter-summary service SHALL report bounded current work and cumulative node memory-hit, disk-hit, build, eviction, leaf-extraction, queued-leaf, and extracted-source metrics.

#### Scenario: Large coarse summary is prepared
- **WHEN** a coarse request recursively prepares summary nodes
- **THEN** voxel metrics distinguish node traversal and cache churn from actual cold LOD 1 source extraction

#### Scenario: Leaf extraction waits for capacity
- **WHEN** cold leaf demand exceeds the configured extraction concurrency
- **THEN** metrics report active and queued leaf extraction counts without representing queued leaves as worker-pool jobs
