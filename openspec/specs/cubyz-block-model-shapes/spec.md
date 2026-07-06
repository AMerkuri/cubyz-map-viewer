## Purpose

Define how Cubyz block model shapes are discovered, encoded, cached, and rendered in voxel meshes.

## Requirements

### Requirement: Server builds block shape metadata from Cubyz assets
The server SHALL build voxel block shape metadata from the active save palette, layered Cubyz block definitions, block model OBJ assets, supported block model reference forms, and supported block rotation metadata during startup.

#### Scenario: Layered assets define a supported model block
- **WHEN** a palette entry resolves to a block definition with a supported `.model` reference in either core assets or save override assets
- **THEN** the server records shape metadata for that palette entry using the highest-priority layered asset source

#### Scenario: Texture-pile model object defines a supported plane model
- **WHEN** a palette entry resolves to a block definition using `cubyz:texture_pile` with `.model = .{ .model = <model-ref>, .states = <count> }`
- **THEN** the server records shape metadata using the referenced model asset and finite state count instead of falling back to cube geometry

#### Scenario: Block definition or model asset is unsupported
- **WHEN** a palette entry references unsupported model or rotation metadata
- **THEN** the server uses a safe fallback shape for that palette entry and logs a diagnostic without failing startup

### Requirement: Voxel meshes include supported non-cube block model geometry
The voxel mesh generator SHALL emit explicit model quads for supported non-cube block shapes while preserving greedy merged cube geometry for full-cube blocks.

#### Scenario: LOD 1 voxel region contains a supported torch block
- **WHEN** the server generates a LOD 1 voxel mesh for a region containing a supported torch model block
- **THEN** the encoded mesh contains torch model quads with fractional in-block coordinates instead of a full unit cube for that block

#### Scenario: Voxel region contains normal terrain cubes
- **WHEN** the server generates a voxel mesh for full-cube terrain blocks
- **THEN** those blocks continue to use greedy merged cube geometry rather than per-block explicit model quads

### Requirement: Block data selects supported model variants
The voxel mesh generator SHALL preserve the upper 16-bit Cubyz block `data` value and use it to select supported model variants or rotations for blocks whose supported rotation mode depends on block data.

#### Scenario: Supported rotated plant or torch is encountered
- **WHEN** a block value contains a supported palette index and non-zero block `data` selecting a supported orientation or model state
- **THEN** the generated model quads match the supported orientation or state represented by that block `data`

#### Scenario: Unsupported block data mode is encountered
- **WHEN** a block uses a rotation mode whose data semantics are not supported by the viewer
- **THEN** the voxel mesh uses the fallback shape for that block rather than applying an incorrect data interpretation

### Requirement: Voxel binary payload supports fractional vertex positions
The `/api/voxels` binary mesh payload SHALL encode vertex positions with sufficient precision to represent fractional coordinates inside a voxel cell.

#### Scenario: Client decodes fractional model coordinates
- **WHEN** the client worker decodes a voxel mesh containing fixed-point model vertices
- **THEN** the resulting Three.js geometry places those vertices at their fractional world positions relative to the voxel region origin and LOD voxel size

#### Scenario: Existing cube geometry is encoded in fractional-capable format
- **WHEN** the server encodes full-cube greedy quads using the fractional-capable payload format
- **THEN** the client decodes them to the same world-space cube boundaries as before the format change

### Requirement: Shape assets participate in voxel cache validity
Voxel mesh cache keys SHALL include a version or signature for block shape metadata so meshes are invalidated when shape-affecting assets, supported shape interpretation semantics, or the shape payload format changes.

#### Scenario: Shape payload format changes
- **WHEN** the voxel binary coordinate format or shape generator semantics change
- **THEN** previously persisted voxel mesh cache entries are not reused

#### Scenario: Block model asset inputs change
- **WHEN** shape-affecting Cubyz block definitions or model assets change between server starts
- **THEN** generated voxel meshes reflect the current shape metadata rather than stale cached geometry

#### Scenario: Supported shape interpretation changes
- **WHEN** the server changes how a supported Cubyz model or rotation metadata form is interpreted into voxel geometry
- **THEN** generated voxel meshes reflect the new interpretation rather than stale cached geometry produced by the previous implementation

### Requirement: Higher LODs avoid tiny unsupported decorative geometry
The voxel mesh generator SHALL apply conservative higher-LOD behavior for supported non-cube blocks by using available `lodReplacement` metadata or a documented fallback when fractional model geometry is not emitted for that LOD.

#### Scenario: Decorative block has air LOD replacement
- **WHEN** a non-cube decorative block defines `lodReplacement = "cubyz:air"` and the server generates a higher LOD mesh where model geometry is not emitted
- **THEN** the block does not appear as an oversized full cube in that higher LOD mesh

#### Scenario: Higher LOD fallback is required
- **WHEN** a non-cube block has no usable LOD replacement for a higher LOD mesh
- **THEN** the server applies the documented fallback shape behavior consistently for that block
