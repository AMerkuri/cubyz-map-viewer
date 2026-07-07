# Cubyz Rotation Shape Semantics

## Purpose
Specify how Cubyz rotation and shape semantics are interpreted for voxel metadata, mesh generation, cache validity, and higher LOD fallbacks.

## Requirements

### Requirement: Server recognizes Cubyz rotation shape semantics
The server SHALL build voxel shape metadata for supported Cubyz rotation modes whose visible geometry depends on block definitions, block `data`, generated variants, finite model states, or neighbor-connectivity state.

#### Scenario: Supported rotation semantic is present in the palette
- **WHEN** the active save palette contains a block definition using a supported rotation semantic
- **THEN** the server records semantic shape metadata for that palette entry during startup

#### Scenario: Texture-pile semantic is present in the palette
- **WHEN** the active save palette contains a block definition using `cubyz:texture_pile` with a supported model object and state count
- **THEN** the server records semantic shape metadata for that palette entry during startup

#### Scenario: Unsupported rotation semantic is present in the palette
- **WHEN** the active save palette contains a block definition using an unsupported rotation semantic or malformed semantic model data
- **THEN** the server records a safe fallback shape and logs a diagnostic identifying the block ID and unsupported semantic

### Requirement: Voxel meshes render chiseled sub-block geometry
The voxel mesh generator SHALL render supported `cubyz:stairs` block states using the block `data` sub-block mask instead of rendering every state as a full cube.

#### Scenario: Half-block state is encountered
- **WHEN** an LOD 1 voxel region contains a `cubyz:stairs` block whose `data` masks out part of the 2x2x2 sub-block occupancy
- **THEN** the generated mesh contains only the visible faces of the occupied sub-block portions

#### Scenario: Fully occupied stairs state is encountered
- **WHEN** an LOD 1 voxel region contains a `cubyz:stairs` block whose `data` represents a fully occupied cube
- **THEN** the voxel mesh may use the standard cube path while preserving the same visible geometry as a full block

### Requirement: Voxel meshes render connectivity model blocks
The voxel mesh generator SHALL render supported connectivity model blocks according to their saved block `data` connection state.

#### Scenario: Fence or wall block has horizontal connections
- **WHEN** an LOD 1 voxel region contains a supported `cubyz:fence` block such as a fence, wall, or bars block
- **THEN** the generated mesh includes the center post and only the connected horizontal arms represented by the block `data`

#### Scenario: Branch block has multi-axis connections
- **WHEN** an LOD 1 voxel region contains a supported `cubyz:branch` block
- **THEN** the generated mesh includes branch surface geometry matching the six-direction connection bits represented by the block `data`

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

### Requirement: Shape semantic support participates in voxel cache validity
Voxel mesh cache keys SHALL include a shape semantic version or signature so generated meshes are invalidated when supported rotation semantics or generated shape variants change.

#### Scenario: Rotation semantic implementation changes
- **WHEN** the server changes how a supported rotation semantic generates voxel geometry
- **THEN** previously persisted voxel mesh cache entries generated with the older semantic behavior are not reused

#### Scenario: Shape-affecting asset inputs change
- **WHEN** block definitions or model assets used by supported semantic shape metadata change between server starts
- **THEN** generated voxel meshes reflect the current shape metadata rather than stale cached geometry

### Requirement: Higher LODs use conservative semantic fallbacks
The voxel mesh generator SHALL avoid rendering small non-standard semantic geometry as oversized full cubes at higher LODs.

#### Scenario: Semantic block has an LOD replacement
- **WHEN** a supported semantic block defines a usable `lodReplacement` and the server generates a higher LOD mesh
- **THEN** the voxel generator uses the replacement behavior for that LOD rather than emitting LOD 1 semantic detail

#### Scenario: Semantic block has no usable higher LOD representation
- **WHEN** a supported semantic block has no usable LOD replacement and the server generates a higher LOD mesh
- **THEN** the voxel generator applies a documented fallback consistently for that block type

### Requirement: Voxel meshes render texture-pile plane geometry
The voxel mesh generator SHALL render supported `cubyz:texture_pile` blocks using their referenced non-cube model geometry and saved finite state data instead of rendering them as full cubes.

#### Scenario: Leaf pile texture-pile block is encountered
- **WHEN** an LOD 1 voxel region contains a supported `cubyz:texture_pile` block such as `cubyz:red_leaf_pile`, `cubyz:dead_leaf_pile`, or `cubyz:yellow_leaf_pile`
- **THEN** the generated mesh contains plane-style model quads for that block rather than a full unit cube

#### Scenario: Texture-pile data exceeds finite states
- **WHEN** an LOD 1 voxel region contains a supported `cubyz:texture_pile` block whose block `data` is outside the configured state count
- **THEN** the generated mesh uses a valid clamped or fallback state without failing mesh generation

#### Scenario: Higher LOD texture-pile block has air replacement
- **WHEN** a supported `cubyz:texture_pile` block defines `lodReplacement = "cubyz:air"` and the server generates a higher LOD mesh
- **THEN** the voxel generator uses the replacement behavior for that LOD rather than emitting an oversized full cube
