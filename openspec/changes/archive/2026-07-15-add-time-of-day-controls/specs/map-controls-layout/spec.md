## ADDED Requirements

### Requirement: Compact Map Controls Toggle Layout
The Map Controls interface SHALL present its layer visibility toggles in a two-column button grid using the same compact visual density as the Graphics Presets controls.

#### Scenario: Desktop toggle layout is compact
- **WHEN** a user opens the desktop Map Controls panel
- **THEN** the layer visibility toggles are displayed as compact buttons in a two-column grid rather than a vertical sequence of full-width buttons

#### Scenario: Compact toggle layout is available on mobile
- **WHEN** a user opens the Controls tab in the mobile HUD tray
- **THEN** the layer visibility toggles use the same two-column grid arrangement while preserving the compact control styling
