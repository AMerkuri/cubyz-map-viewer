## ADDED Requirements

### Requirement: Model shape voxel generation remains within performance budget
The voxel mesh generator SHALL expose and enforce a bounded cost for LOD 1 model and semantic block geometry so detailed model quads do not unboundedly dominate region payload size, worker decode cost, or retained mesh memory.

#### Scenario: Region contains dense model-backed blocks
- **WHEN** the server generates a LOD 1 voxel mesh for a region whose supported model or semantic blocks would produce excessive explicit model quads
- **THEN** the generated mesh MUST remain within the configured model-geometry budget by using documented fallback or reduction behavior
- **THEN** the response metrics MUST report enough information to distinguish model or semantic quads from greedy cube quads

#### Scenario: Region contains ordinary full-cube terrain
- **WHEN** the server generates a voxel mesh for full-cube terrain blocks without fractional model geometry
- **THEN** those blocks MUST continue using greedy merged cube geometry and MUST NOT pay model-geometry encoding overhead beyond what is required by the active payload format

### Requirement: Voxel payload optimizes common cube geometry
The `/api/voxels` binary mesh payload SHALL avoid using the most expensive fractional vertex representation for ordinary greedy full-cube geometry when a compact representation can preserve identical decoded world-space geometry.

#### Scenario: Payload contains only greedy cube quads
- **WHEN** the server encodes a voxel mesh whose geometry can be represented with integer cell coordinates
- **THEN** the payload MUST use a compact representation for those positions or an equivalently bounded format
- **THEN** the client worker MUST decode the geometry to the same world-space cube boundaries

#### Scenario: Payload contains fractional model quads
- **WHEN** the server encodes a voxel mesh containing supported model vertices with fractional or authored out-of-block coordinates
- **THEN** the payload MUST preserve sufficient precision for those vertices
- **THEN** cache validity MUST distinguish the payload format and shape interpretation used to generate the mesh
