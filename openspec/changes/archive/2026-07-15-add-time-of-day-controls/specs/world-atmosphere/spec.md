## MODIFIED Requirements

### Requirement: Configurable Atmospheric Time Of Day
The viewer SHALL support a client-side atmospheric time-of-day state that controls visual lighting and sky presentation without changing server data or Cubyz world contracts. The Map Controls interface SHALL provide always-visible discrete buttons for Dawn, Noon, Dusk, and Midnight, while the Advanced Parameters interface SHALL retain fine-grained time-of-day adjustment.

#### Scenario: Time of day updates scene lighting
- **WHEN** the atmosphere time of day changes
- **THEN** the visible sun direction, light colors, and light intensities update to match that atmospheric time while terrain and voxel geometry remain unchanged

#### Scenario: Map Controls select a named lighting time
- **WHEN** a user selects Dawn, Noon, Dusk, or Midnight in Map Controls
- **THEN** the viewer stores and applies the corresponding client-local time-of-day value of 6, 12, 18, or 0 respectively
- **AND** the selected named time is visually active

#### Scenario: Advanced slider selects a custom lighting time
- **WHEN** a user selects a time-of-day value other than 0, 6, 12, or 18 with the Advanced Parameters slider
- **THEN** the viewer applies that exact client-local lighting time
- **AND** none of the named Map Controls time buttons is visually active
- **AND** Map Controls displays a `Custom` indicator beside Time Of Day

#### Scenario: Graphics Presets preserve the selected lighting time
- **WHEN** a user applies a Graphics Preset
- **THEN** the viewer applies the preset's supported graphics settings without changing the current client-local atmosphere time of day

#### Scenario: Changing time preserves the active Graphics Preset
- **WHEN** a user changes time of day while all other settings match a Graphics Preset
- **THEN** that Graphics Preset remains visually active

#### Scenario: Atmosphere remains client-local
- **WHEN** the viewer applies an atmosphere time of day
- **THEN** no server route payload, WebSocket event, voxel worker protocol, or Cubyz file parsing behavior is changed
