## MODIFIED Requirements

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

### Requirement: Voxel meshes render attachment and direction variants
The voxel mesh generator SHALL render supported attachment and direction-based model variants according to the block `data` semantics of their rotation mode.

#### Scenario: Carpet-style block attaches to faces
- **WHEN** an LOD 1 voxel region contains a supported `cubyz:carpet` block
- **THEN** the generated mesh includes model geometry on the block faces represented by the block `data`

#### Scenario: Sign-style floor or ceiling block uses eight-way orientation
- **WHEN** an LOD 1 voxel region contains a supported `cubyz:sign` floor or ceiling block with block `data` in the floor range `0..7` or ceiling range `8..15`
- **THEN** the generated mesh uses the floor or ceiling model variant rotated in the corresponding 45-degree increment represented by the block `data`

#### Scenario: Sign-style side block uses wall attachment state
- **WHEN** an LOD 1 voxel region contains a supported `cubyz:sign` side block with block `data` in the side range `16..19`
- **THEN** the generated mesh uses the side model variant attached to the corresponding `-X`, `-Y`, `+X`, or `+Y` face represented by the block `data`

#### Scenario: Hanging or direction block selects a finite model variant
- **WHEN** an LOD 1 voxel region contains a supported `cubyz:hanging` or selected `cubyz:direction` model block
- **THEN** the generated mesh uses the model variant represented by the block `data`

## ADDED Requirements

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
