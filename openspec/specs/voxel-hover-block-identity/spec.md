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

### Requirement: Hover picking considers only rendered geometry
The system SHALL restrict cursor hover intersection queries to effectively visible voxel meshes and terrain tiles, excluding objects hidden directly or by an ancestor before mesh raycasting occurs.

#### Scenario: Hidden overlapping voxel LOD is excluded
- **WHEN** visible voxel geometry overlaps retained voxel geometry that is hidden for the current LOD selection
- **THEN** the hover query raycasts the visible geometry and does not raycast the hidden geometry
- **THEN** the reported block identity and coordinates come from the best visible voxel face under the pointer

#### Scenario: Invisible ancestor excludes a visible child
- **WHEN** a voxel or terrain mesh has its local visibility enabled beneath an invisible ancestor
- **THEN** the hover query does not raycast that mesh

#### Scenario: Hidden terrain tile is excluded from fallback
- **WHEN** no visible voxel face is under the pointer and loaded terrain contains both visible and hidden tiles along the ray
- **THEN** the hover query reports coordinates from the nearest visible terrain tile
- **THEN** hidden terrain tiles are not eligible for the result

### Requirement: Pointer movement coalesces hover inspection
The system SHALL coalesce cursor hover refresh requests so no more than one intersection query executes per browser animation frame and the query uses the latest eligible pointer position.

#### Scenario: Multiple pointer movements before a frame
- **WHEN** multiple eligible pointer movement events occur before the next browser animation frame
- **THEN** exactly one hover intersection query executes for that frame
- **THEN** the query uses the coordinates from the latest pointer movement event

#### Scenario: Interaction starts before a pending refresh
- **WHEN** a hover refresh is pending and an orbit drag, keyboard movement, pointer cancellation, or pointer leave makes hover inspection ineligible before execution
- **THEN** the pending refresh does not perform an intersection query

#### Scenario: Pointer movement continues across frames
- **WHEN** eligible pointer movement continues across multiple browser animation frames
- **THEN** each frame executes at most one hover intersection query
- **THEN** hover coordinates continue to follow the latest pointer position

### Requirement: Optimized hover preserves selection semantics
Visible-only and coalesced hover inspection SHALL preserve voxel precedence over terrain, visible fine-LOD tie-breaking, and block identity resolution for opaque, transparent, and model-backed voxel faces.

#### Scenario: Visible voxel takes precedence over terrain
- **WHEN** the pointer ray intersects both visible voxel geometry and visible terrain
- **THEN** the hover result reports the selected voxel face and its resolvable block identity instead of the terrain hit

#### Scenario: Visible overlapping voxel faces require a tie-break
- **WHEN** visible voxel intersections from different LODs are within the existing overlap tolerance
- **THEN** the hover result selects the finer visible LOD

#### Scenario: Optimized face types retain identity
- **WHEN** the selected visible face is opaque, transparent, or model-backed and has a resolvable palette mapping
- **THEN** the hover result includes the corresponding saved Cubyz block ID
