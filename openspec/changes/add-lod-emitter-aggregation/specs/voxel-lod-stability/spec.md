## ADDED Requirements

### Requirement: Voxel LOD transitions preserve emitted-light cues
The viewer SHALL preserve important emitted-light cues across voxel LOD transitions so strong or clustered light sources do not visibly disappear solely because the selected voxel geometry changed to a coarser LOD.

#### Scenario: Lit area transitions from LOD 1 to coarser LOD
- **WHEN** a visible area containing strong or clustered emitters transitions from LOD 1 voxel geometry to a coarser voxel LOD
- **THEN** representative emitted-light records preserve a bounded visible light cue for that area

#### Scenario: Coarser LOD is budget constrained
- **WHEN** a coarser LOD region contains more emitters than the aggregation or runtime budget allows
- **THEN** the viewer prioritizes stronger or clustered light cues and remains stable without requiring every fine emitter to remain visible
