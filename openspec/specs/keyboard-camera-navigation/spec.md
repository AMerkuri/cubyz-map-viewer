## Purpose

TBD - Define keyboard-based camera navigation behavior in the map viewer.

## Requirements

### Requirement: Keyboard camera translation
The viewer SHALL move the camera and its target horizontally in the direction requested by W, A, S, D, or the corresponding arrow keys, using the existing distance- and frame-time-scaled translation behavior.

#### Scenario: Camera moves with a directional key
- **WHEN** a user holds one or more W/A/S/D or arrow keys while the viewer is active
- **THEN** the viewer moves the camera and its target horizontally in the requested normalized direction

### Requirement: Shift precision camera translation
The viewer SHALL reduce W/A/S/D and arrow-key camera translation to exactly 50% of the translation distance calculated without Shift whenever either left or right Shift is held concurrently.

#### Scenario: Left Shift reduces directional movement
- **WHEN** a user holds ShiftLeft and a W/A/S/D or arrow key for a frame
- **THEN** the camera and target move in the requested direction by half the distance they would move for the same frame without Shift

#### Scenario: Right Shift reduces directional movement
- **WHEN** a user holds ShiftRight and a W/A/S/D or arrow key for a frame
- **THEN** the camera and target move in the requested direction by half the distance they would move for the same frame without Shift

#### Scenario: Shift alone does not move the camera
- **WHEN** a user holds Shift without a W/A/S/D or arrow key
- **THEN** the viewer does not translate the camera or its target

### Requirement: Shift preserves non-translation keyboard controls
The viewer SHALL preserve the existing Q/E orbit rotation and Space spawn-focus behavior when Shift is held.

#### Scenario: Shift does not slow keyboard rotation
- **WHEN** a user holds Shift and Q or E for a frame without a translation key
- **THEN** the camera rotates around its target by the same amount as Q or E without Shift

#### Scenario: Shift does not prevent spawn focus
- **WHEN** a user presses Space while Shift is held
- **THEN** the viewer focuses the camera on spawn using the existing behavior

### Requirement: Precision movement guidance
The desktop Map Controls keyboard instructions SHALL state that holding Shift while moving with W/A/S/D or arrow keys enables slower camera movement.

#### Scenario: User views desktop keyboard instructions
- **WHEN** a user opens the desktop Map Controls panel
- **THEN** the Keyboard section includes the Shift slow-movement shortcut in addition to the existing movement, rotation, and spawn-focus instructions
