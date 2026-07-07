## Purpose

Define how voxel cursor hover exposes and displays the saved Cubyz block ID for rendered voxel geometry.

## Requirements

### Requirement: Voxel hover reports block ID
When the cursor hover ray intersects rendered voxel geometry, the system SHALL report the saved Cubyz block ID for the visible voxel face under the pointer.

#### Scenario: Hovering a voxel block face
- **WHEN** the pointer hovers over a rendered voxel face whose palette index resolves to `cubyz:grass`
- **THEN** the cursor hover information includes block ID `cubyz:grass`

#### Scenario: Hovering a model-backed voxel face
- **WHEN** the pointer hovers over a rendered voxel face whose palette index resolves to `cubyz:log/oak`
- **THEN** the cursor hover information includes block ID `cubyz:log/oak`

### Requirement: Advanced voxel hover displays block ID only
When advanced mode is enabled, the cursor HUD SHALL display the hovered voxel block ID on a second row after the X/Y/Z coordinate and SHALL NOT display block data, orientation, or variant metadata.

#### Scenario: Displaying voxel hover identity
- **WHEN** advanced mode is enabled and cursor hover information contains position `[10, 20, 30]` and block ID `cubyz:grass`
- **THEN** the cursor HUD displays the coordinates on the first row
- **THEN** the cursor HUD displays `cubyz:grass` on the second row
- **THEN** the cursor HUD does not display block data, orientation, or variant metadata

#### Scenario: Advanced mode disabled
- **WHEN** advanced mode is disabled and cursor hover information contains position `[10, 20, 30]` and block ID `cubyz:grass`
- **THEN** the cursor HUD displays X/Y/Z coordinates
- **THEN** the cursor HUD does not display a block ID

### Requirement: Terrain hover remains coordinate-only
When the cursor hover ray intersects terrain underlay rather than rendered voxel geometry, the system SHALL continue to report and display coordinates without block identity.

#### Scenario: Hovering terrain underlay
- **WHEN** the pointer hovers over terrain underlay and no rendered voxel face is selected
- **THEN** the cursor HUD displays X/Y/Z coordinates
- **THEN** the cursor HUD does not display a block ID

### Requirement: Missing block mapping preserves hover coordinates
When a hovered voxel face has no resolvable block ID, the system SHALL preserve existing coordinate hover behavior and omit block identity.

#### Scenario: Hovering voxel face with missing palette mapping
- **WHEN** the pointer hovers over a rendered voxel face whose palette index cannot be resolved to a block ID
- **THEN** the cursor HUD displays X/Y/Z coordinates
- **THEN** the cursor HUD does not display a fallback or guessed block ID

### Requirement: Hover identity survives voxel payload optimization
Voxel payload and client retention optimizations SHALL preserve the ability to resolve the saved Cubyz block ID for rendered opaque, transparent, and model-backed voxel faces under the cursor.

#### Scenario: Hovering optimized cube geometry
- **WHEN** the pointer hovers over a rendered voxel face decoded from an optimized compact cube representation
- **THEN** the cursor hover information MUST include the corresponding saved Cubyz block ID when the palette mapping is available

#### Scenario: Hovering optimized model or transparent geometry
- **WHEN** the pointer hovers over a rendered model-backed or transparent voxel face after payload or metadata retention optimization
- **THEN** the cursor hover information MUST include the corresponding saved Cubyz block ID when the palette mapping is available

#### Scenario: Hover metadata is reduced
- **WHEN** implementation reduces retained per-triangle or per-vertex metadata for voxel meshes
- **THEN** the remaining metadata MUST still map cursor intersections to the correct save block palette index or intentionally omit identity only when no resolvable palette mapping exists

### Requirement: Hover identity survives parametric greedy decode
The optimized voxel payload and worker decode path SHALL preserve the ability to resolve the saved Cubyz block ID for rendered faces decoded from parametric greedy records and fractional model records.

#### Scenario: Hovering parametric greedy cube geometry
- **WHEN** the pointer hovers over a rendered voxel face decoded from a parametric greedy cube record
- **THEN** the cursor hover information MUST include the corresponding saved Cubyz block ID when the palette mapping is available

#### Scenario: Hovering fractional model geometry after direct decode
- **WHEN** the pointer hovers over a rendered model-backed voxel face decoded through the optimized worker path
- **THEN** the cursor hover information MUST include the corresponding saved Cubyz block ID when the palette mapping is available

#### Scenario: Hovering transparent optimized geometry
- **WHEN** the pointer hovers over a rendered transparent voxel face decoded from either a parametric greedy record or fractional model record
- **THEN** the cursor hover information MUST include the corresponding saved Cubyz block ID when the palette mapping is available
