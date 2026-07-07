## MODIFIED Requirements

### Requirement: Voxel meshes render attachment and direction variants
The voxel mesh generator SHALL render supported attachment and direction-based model variants according to the block `data` semantics of their rotation mode, matching Cubyz game orientation for saved direction data values.

#### Scenario: Carpet-style block attaches to faces
- **WHEN** an LOD 1 voxel region contains a supported `cubyz:carpet` block
- **THEN** the generated mesh includes model geometry on the block faces represented by the block `data`

#### Scenario: Sign-style floor or ceiling block uses eight-way orientation
- **WHEN** an LOD 1 voxel region contains a supported `cubyz:sign` floor or ceiling block with block `data` in the floor range `0..7` or ceiling range `8..15`
- **THEN** the generated mesh uses the floor or ceiling model variant rotated in the corresponding 45-degree increment represented by the block `data`

#### Scenario: Sign-style side block uses wall attachment state
- **WHEN** an LOD 1 voxel region contains a supported `cubyz:sign` side block with block `data` in the side range `16..19`
- **THEN** the generated mesh uses the side model variant attached to the corresponding `-X`, `-Y`, `+X`, or `+Y` face represented by the block `data`

#### Scenario: Hanging block selects a finite model variant
- **WHEN** an LOD 1 voxel region contains a supported `cubyz:hanging` model block
- **THEN** the generated mesh uses the top or bottom model variant represented by the block `data`

#### Scenario: Direction block uses Cubyz neighbor orientation data
- **WHEN** an LOD 1 voxel region contains a supported `cubyz:direction` model block with block `data` in the Cubyz `Neighbor` range `0..5`
- **THEN** the generated mesh uses the model orientation represented by Cubyz `Neighbor` order: `0 = dirUp`, `1 = dirDown`, `2 = dirPosX`, `3 = dirNegX`, `4 = dirPosY`, and `5 = dirNegY`

#### Scenario: Direction block data exceeds finite variants
- **WHEN** an LOD 1 voxel region contains a supported `cubyz:direction` model block whose block `data` exceeds `5`
- **THEN** the generated mesh uses the same model orientation Cubyz selects for data value `5`
