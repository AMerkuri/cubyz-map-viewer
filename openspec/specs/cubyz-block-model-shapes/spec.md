## Purpose

Define how Cubyz block model shapes are discovered, encoded, cached, and rendered in voxel meshes.

## Requirements

### Requirement: Server builds block shape metadata from Cubyz assets
The server SHALL build voxel block shape metadata from the active save palette, layered Cubyz block definitions, block model OBJ assets, supported block model reference forms, and supported block rotation metadata during startup. Supported OBJ block model vertices SHALL preserve their authored block-local coordinates, including coordinates outside the `0..1` unit-block range, unless explicit supported metadata defines a different coordinate interpretation.

#### Scenario: Layered assets define a supported model block
- **WHEN** a palette entry resolves to a block definition with a supported `.model` reference in either core assets or save override assets
- **THEN** the server records shape metadata for that palette entry using the highest-priority layered asset source

#### Scenario: Texture-pile model object defines a supported plane model
- **WHEN** a palette entry resolves to a block definition using `cubyz:texture_pile` with `.model = .{ .model = <model-ref>, .states = <count> }`
- **THEN** the server records shape metadata using the referenced model asset and finite state count instead of falling back to cube geometry

#### Scenario: Block definition or model asset is unsupported
- **WHEN** a palette entry references unsupported model or rotation metadata
- **THEN** the server uses a safe fallback shape for that palette entry and logs a diagnostic without failing startup

#### Scenario: Authored model bounds exceed one block
- **WHEN** a palette entry resolves to a supported OBJ model whose authored vertex bounds extend outside the `0..1` unit-block range
- **THEN** the server records shape metadata using those authored coordinates rather than shrinking the model through an inferred `16x` downscale

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
