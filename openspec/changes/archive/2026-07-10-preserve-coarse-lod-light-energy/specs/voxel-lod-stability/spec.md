## MODIFIED Requirements

### Requirement: Voxel LOD transitions preserve emitted-light cues
The viewer SHALL preserve the perceived brightness, dominant color, and visible influence footprint of important emitted-light areas across voxel LOD transitions so strong or clustered LOD 1 sources do not progressively dim, shrink, or disappear solely because the selected voxel geometry changed to a coarser LOD. Preservation SHALL use bounded LOD 1-derived representatives and remain constrained by payload, server summary-generation, client emissive-bake, and runtime accent budgets.

#### Scenario: Lit area transitions from LOD 1 to coarser LOD
- **WHEN** a visible area containing strong or clustered LOD 1 emitters transitions to LOD 2, 4, 8, 16, or 32 voxel geometry
- **THEN** representative emitted-light records preserve a recognizable dominant hue and bounded light cue for that area
- **THEN** the cue does not exhibit systematic brightness or footprint loss at each successive LOD solely because fewer same-LOD emitting blocks survived voxel reduction

#### Scenario: Source disappears from coarse voxel data
- **WHEN** an important emitting block is present in LOD 1 source data but absent from the selected coarser voxel chunks
- **THEN** its LOD 1-derived cluster remains eligible to contribute to a coarse representative

#### Scenario: Dense cluster transitions to coarser LOD
- **WHEN** multiple nearby LOD 1 emitters are represented by fewer coarse records
- **THEN** representative power and influence footprint reflect the cluster rather than making each representative equivalent to one LOD 1 emitter
- **THEN** configured compression and clamping prevent the cluster from becoming an oversized saturated light patch

#### Scenario: Coarser LOD is budget constrained
- **WHEN** a coarser LOD region contains more source clusters than the aggregation or runtime budget allows
- **THEN** the viewer prioritizes stronger and more spatially significant light cues without requiring every fine emitter to remain individually visible

#### Scenario: Coarser LOD aggregation is performance constrained
- **WHEN** LOD 1 source summaries or coarse representative records would exceed configured generation, payload, or client emissive-bake budgets
- **THEN** the system reduces summary or representative detail deterministically while preserving the strongest bounded cues

#### Scenario: Representative transition scene is visually validated
- **WHEN** the same nighttime scene and camera are captured at each supported voxel LOD
- **THEN** documented brightness and footprint acceptance bands compare each important lit area against its LOD 1 baseline
- **THEN** validation rejects progressive dimming as well as excessive coarse-LOD overbrightening or footprint growth

#### Scenario: Emissive diagnostics are available
- **WHEN** an LOD transition scene is benchmarked with LOD 1-derived coarse representatives
- **THEN** diagnostics expose source-summary work, representative count, encoded power and footprint ranges, emitter bytes, emissive grid time, emissive bake time, and evaluated or culled quad data sufficient to verify the transition remains within defined budgets
