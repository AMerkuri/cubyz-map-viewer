## ADDED Requirements

### Requirement: Voxel LOD transitions preserve emitted-light cues
The viewer SHALL preserve important emitted-light cues across voxel LOD transitions so strong or clustered light sources do not visibly disappear solely because the selected voxel geometry changed to a coarser LOD. Preservation SHALL remain bounded by payload, client emissive-bake, and runtime accent budgets.

#### Scenario: Lit area transitions from LOD 1 to coarser LOD
- **WHEN** a visible area containing strong or clustered emitters transitions from LOD 1 voxel geometry to a coarser voxel LOD
- **THEN** representative emitted-light records preserve a bounded visible light cue for that area

#### Scenario: Coarser LOD is budget constrained
- **WHEN** a coarser LOD region contains more emitters than the aggregation or runtime budget allows
- **THEN** the viewer prioritizes stronger or clustered light cues and remains stable without requiring every fine emitter to remain visible

#### Scenario: Coarser LOD aggregation is performance constrained
- **WHEN** aggregated coarser LOD emitter records would exceed the configured payload or client emissive-bake budget
- **THEN** the viewer reduces representative records according to the prioritization rules while preserving the strongest or most clustered visible cues

#### Scenario: Recent emissive diagnostics are available
- **WHEN** a LOD transition scene is benchmarked with aggregated coarser LOD emitter records
- **THEN** diagnostics expose enough emitter count, emissive byte, emissive grid, and emissive bake data to verify the transition does not regress client performance beyond the defined budget
