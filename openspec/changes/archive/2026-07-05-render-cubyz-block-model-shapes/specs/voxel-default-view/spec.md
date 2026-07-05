## MODIFIED Requirements

### Requirement: Voxel data prerequisites load immediately
The client SHALL enable voxel chunk-index loading and voxel mesh prerequisites during initial world data loading instead of waiting for a terrain-to-voxel mode switch, including support for decoding voxel meshes that contain supported non-cube Cubyz block model geometry.

#### Scenario: Initial world data request starts
- **WHEN** the world viewer initializes
- **THEN** the client enables chunk-index loading for voxel rendering prerequisites

#### Scenario: World refresh subscription receives voxel region changes
- **WHEN** a terrain update batch includes changed voxel regions after startup
- **THEN** the client can refresh the chunk index because chunk-index loading is enabled

#### Scenario: Voxel mesh includes supported block model shapes
- **WHEN** the initial voxel data requests return meshes containing supported non-cube block model geometry
- **THEN** the client worker decodes those meshes and the scene renders them in voxel mode without requiring any terrain-to-voxel mode transition
