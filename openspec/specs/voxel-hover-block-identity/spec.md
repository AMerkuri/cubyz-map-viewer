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
