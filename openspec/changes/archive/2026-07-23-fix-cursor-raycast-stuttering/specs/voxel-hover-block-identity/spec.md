## ADDED Requirements

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
