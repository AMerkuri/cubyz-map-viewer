## ADDED Requirements

### Requirement: Default layer visibility for first-time users
The client SHALL enable biome labels and terrain underlay by default when no persisted layer visibility settings exist in localStorage. Existing users with stored settings SHALL retain their previously saved layer visibility preferences.

#### Scenario: New visitor with no stored settings
- **WHEN** a user opens the world viewer for the first time with no localStorage graphics settings payload
- **THEN** the client initializes with `biomeLabels` set to `true` and `showTerrainUnderlay` set to `true`

#### Scenario: Existing user with stored settings retains preferences
- **WHEN** a user has a previously stored v3 graphics settings payload in localStorage with `biomeLabels` or `showTerrainUnderlay` set to `false`
- **THEN** the client loads those stored values and does not override them with the new defaults

#### Scenario: Corrupt or partial stored settings fall back to new defaults
- **WHEN** a user has a stored graphics settings payload where the `biomeLabels` or `showTerrainUnderlay` fields are missing or not boolean values
- **THEN** the sanitizer falls back to `true` for those fields

### Requirement: Default camera zoom distance for fresh page loads
The client SHALL use a default camera zoom distance of 500 when no URL camera parameters are present on page load.

#### Scenario: Page loads without camera URL parameters
- **WHEN** the world viewer initializes without `x`, `y`, `z`, `zoom`, `theta`, or `phi` query parameters
- **THEN** the initial camera zoom distance is 500

#### Scenario: Share link with explicit zoom overrides default
- **WHEN** the world viewer initializes from a URL containing an explicit `zoom` parameter
- **THEN** the client uses the supplied zoom value and does not apply the default zoom distance of 500

#### Scenario: Camera zoom clamped within distance bounds
- **WHEN** the default zoom of 500 is applied
- **THEN** the camera distance is clamped within the orbit controls' min and max distance bounds
