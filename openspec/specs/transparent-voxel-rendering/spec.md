## Purpose

Define how transparent voxel blocks are classified, meshed, transported, and rendered so view-through blocks remain visible without behaving like air.

## Requirements

### Requirement: Server classifies transparent voxel blocks separately from air
The server SHALL build palette-indexed voxel visual metadata that distinguishes air blocks, opaque renderable blocks, and transparent renderable blocks using layered Cubyz block definitions.

#### Scenario: Glass inherits transparent defaults
- **WHEN** a palette entry resolves to a Cubyz glass block whose own definition omits `.transparent` but inherits `.transparent = true` from `_defaults.zig.zon`
- **THEN** the server classifies that palette entry as transparent renderable rather than air or opaque

#### Scenario: Air remains non-renderable
- **WHEN** a palette entry resolves to `cubyz:air`
- **THEN** the server classifies that palette entry as air and emits no voxel geometry for it

#### Scenario: Opaque blocks remain opaque
- **WHEN** a palette entry resolves to a normal solid block without transparent metadata
- **THEN** the server classifies that palette entry as opaque renderable

### Requirement: Voxel generation preserves visibility through transparent blocks
Voxel mesh generation SHALL treat transparent renderable blocks as traversable for exterior visibility while still emitting transparent voxel faces for those blocks.

#### Scenario: Opaque block behind glass is visible
- **WHEN** an exterior ray path reaches one or more transparent glass blocks before an opaque block
- **THEN** voxel generation includes transparent faces for the glass blocks and opaque faces for the block behind them when those faces are within the visible voxel depth range

#### Scenario: Transparent block does not stop traversal
- **WHEN** flood-fill traversal enters a transparent renderable block
- **THEN** traversal may continue through that block to discover additional visible transparent or opaque faces

#### Scenario: Adjacent same transparent blocks avoid unnecessary internal faces
- **WHEN** two adjacent transparent blocks have the same block ID/visual group and neither boundary is externally visible
- **THEN** voxel generation does not emit redundant internal faces between them, suppresses duplicate same-plane transparent cells, merges matching exterior transparent faces, and avoids per-face AO darkening, so connected same-type transparent blocks render as a unified transparent volume even if the save palette contains duplicate entries

### Requirement: Voxel payload carries transparent render information
The voxel payload SHALL carry enough information for the browser worker to separate opaque and transparent quads while preserving per-face color, winding, geometry, and palette identity.

#### Scenario: Worker decodes transparent and opaque quads
- **WHEN** the client worker receives a voxel payload containing both opaque and transparent quads
- **THEN** it decodes mesh arrays that allow the client to build separate opaque and transparent Three.js meshes

#### Scenario: Hover identity is preserved for transparent faces
- **WHEN** the cursor intersects a transparent voxel face
- **THEN** the client can resolve the face's save block palette index to the corresponding block ID using the existing block palette data

#### Scenario: Stale payloads are invalidated
- **WHEN** the transparent voxel payload format or render classification semantics change
- **THEN** persisted voxel mesh cache entries generated with the previous semantics are not reused

### Requirement: Client renders transparent voxel faces as view-through geometry
The client SHALL render transparent voxel faces separately from opaque voxel faces so opaque geometry behind one or more transparent blocks remains visible.

#### Scenario: Multiple glass blocks before opaque geometry
- **WHEN** the camera view passes through multiple transparent glass faces before reaching an opaque voxel face
- **THEN** the opaque voxel face remains visible through the transparent faces with an approximate accumulated tint

#### Scenario: Opaque voxels keep existing material behavior
- **WHEN** a voxel payload contains opaque quads
- **THEN** the client renders those quads with the existing opaque voxel material behavior

#### Scenario: Transparent tops do not fully hide terrain underlay
- **WHEN** visible voxel coverage is produced only by transparent top faces over terrain
- **THEN** the client does not treat those transparent faces as fully opaque terrain-underlay occluders
