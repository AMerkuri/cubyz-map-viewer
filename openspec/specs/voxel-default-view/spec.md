## Purpose

Define the viewer behavior for voxel-only default world-view initialization and controls.

## Requirements

### Requirement: Viewer starts in voxel mode
The client SHALL initialize the world view in voxel mode for all page loads, regardless of whether the URL contains no mode parameter, `mode=terrain`, `mode=voxel`, or an unrecognized mode value.

#### Scenario: Page loads without mode parameter
- **WHEN** the user opens the world viewer without a `mode` query parameter
- **THEN** the client initializes the scene and controls in voxel mode

#### Scenario: Page loads with legacy terrain mode parameter
- **WHEN** the user opens a world viewer URL containing `mode=terrain`
- **THEN** the client initializes the scene and controls in voxel mode

#### Scenario: Page loads with voxel mode parameter
- **WHEN** the user opens a world viewer URL containing `mode=voxel`
- **THEN** the client initializes the scene and controls in voxel mode

### Requirement: Terrain mode selector is not shown
The client SHALL NOT expose a terrain/voxel mode selector in the HUD when voxel mode is the only available user-facing mode.

#### Scenario: Desktop HUD renders
- **WHEN** the desktop HUD toolbar is displayed
- **THEN** the toolbar does not include Terrain or Voxels mode tabs

#### Scenario: Compact HUD renders
- **WHEN** the compact HUD toolbar is displayed
- **THEN** the toolbar does not include Terrain or Voxels mode tabs

### Requirement: Voxel data prerequisites load immediately
The client SHALL enable voxel chunk-index loading during initial world data loading instead of waiting for a terrain-to-voxel mode switch.

#### Scenario: Initial world data request starts
- **WHEN** the world viewer initializes
- **THEN** the client enables chunk-index loading for voxel rendering prerequisites

#### Scenario: World refresh subscription receives voxel region changes
- **WHEN** a terrain update batch includes changed voxel regions after startup
- **THEN** the client can refresh the chunk index because chunk-index loading is enabled

### Requirement: Voxel-mode controls remain available
The client SHALL keep controls that apply to voxel-mode rendering available according to their existing visibility rules.

#### Scenario: Voxel-only controls render
- **WHEN** the map controls render in the voxel-default viewer
- **THEN** voxel-specific controls such as terrain underlay and voxel debug parameters remain available where they were previously shown in voxel mode
