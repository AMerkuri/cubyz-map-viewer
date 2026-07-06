## ADDED Requirements

### Requirement: Sign text fetching

The client SHALL fetch per-region sign records from the sign records HTTP route using a dedicated React Query hook within the world-view feature. Sign record fetching SHALL be keyed by LOD and region coordinate, consistent with existing voxel/region data loading.

#### Scenario: Sign records loaded for visible regions

- **WHEN** voxel regions are loaded for the current view at the sign-text LOD threshold
- **THEN** the client SHALL fetch and cache the corresponding sign records for those regions

#### Scenario: Sign records invalidated on world update

- **WHEN** the client receives a `world-updated` or `terrain-updates-batch` WebSocket event affecting a region with signs
- **THEN** the client SHALL invalidate and refetch that region's sign records

### Requirement: On-face text rendering

The client SHALL render each sign's text as a single texture-mapped quad placed coplanar with the sign's front face, using the world-space text-plane corners provided in the sign record. The text texture SHALL be produced on a canvas mirroring the in-game layout: a 128x72 pixel canvas with a 4px margin (120x64 usable area), transparent background, black text, the Unscii-16 font at native pixel size, and no drop shadow.

Text layout SHALL match the game: each line horizontally centered within the usable width, lines stacked top-down at 16px line height, explicit `\n` producing hard line breaks, automatic word-wrapping at the usable width, and a hard mid-word break when a single word exceeds the usable width. Text exceeding the usable height SHALL be clipped.

The text quad SHALL be offset slightly toward the viewer relative to the sign board to avoid z-fighting, and SHALL respect terrain occlusion so signs hide behind intervening geometry.

#### Scenario: Single-line sign

- **WHEN** a sign record has single-line text
- **THEN** the client SHALL render that text centered on the sign face, oriented and tilted with the sign

#### Scenario: Multi-line sign

- **WHEN** a sign record's text contains newlines or wraps at the usable width
- **THEN** the client SHALL render multiple centered lines stacked at 16px line height within the sign face

#### Scenario: Occlusion behind terrain

- **WHEN** terrain geometry is between the camera and a sign
- **THEN** the sign text SHALL be occluded by that geometry rather than drawn on top

### Requirement: LOD-gated visibility

Sign text SHALL be rendered only when closely zoomed in, at LOD 1. At coarser LODs the client SHALL NOT build or display sign text quads. When the active LOD changes away from LOD 1, existing sign text quads SHALL be removed; when it returns to LOD 1, they SHALL be rebuilt.

#### Scenario: Zoomed in at LOD 1

- **WHEN** the active LOD is 1
- **THEN** sign text quads SHALL be built and visible on sign faces

#### Scenario: Zoomed out beyond LOD 1

- **WHEN** the active LOD is coarser than 1
- **THEN** no sign text quads SHALL be present in the scene

### Requirement: Resource lifecycle

The client SHALL dispose sign text canvases, textures, geometries, and materials when their regions unload, when sign records change, or when the LOD moves away from the sign-text threshold, to avoid leaking GPU or memory resources. Sign text rendering SHALL be driven imperatively within the scene runtime and SHALL NOT push per-frame sign state into React state.

#### Scenario: Region unload

- **WHEN** a region with rendered sign text is unloaded from view
- **THEN** the client SHALL dispose that region's sign text textures, geometries, and materials

#### Scenario: Sign text updated

- **WHEN** a sign's text changes and new records are fetched
- **THEN** the client SHALL dispose the stale text texture and rebuild the quad from the new text
