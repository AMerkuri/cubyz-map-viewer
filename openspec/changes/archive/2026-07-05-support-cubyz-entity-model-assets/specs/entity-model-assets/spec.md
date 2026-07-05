## ADDED Requirements

### Requirement: Player marker manifest
The server SHALL expose a player marker asset manifest derived from layered Cubyz `entityModels` descriptors.

#### Scenario: Tagged player model is available
- **WHEN** core or save assets contain an `entityModels` descriptor tagged `.playerModel` with resolvable model and texture references
- **THEN** the manifest response includes the selected entity model ID, model URL, texture URL, height, and coordinate system

#### Scenario: No tagged player model is available
- **WHEN** no layered `entityModels` descriptor tagged `.playerModel` can be resolved
- **THEN** the manifest response indicates that no player marker model is available without causing player data loading to fail

### Requirement: Layered entity model asset resolution
The server SHALL resolve entity model descriptors, GLB model files, and PNG texture files using the same core-assets-plus-save-overrides precedence used for other layered Cubyz assets.

#### Scenario: Save asset overrides core asset
- **WHEN** both the save assets and core Cubyz assets provide the same namespace-relative entity model descriptor, model, or texture file
- **THEN** the server serves the save asset version for player marker loading

#### Scenario: Referenced asset is missing
- **WHEN** a selected entity model descriptor references a model or texture file that cannot be resolved from layered assets
- **THEN** the server does not return that descriptor as a loadable player marker manifest

### Requirement: Client loads manifest-driven player marker models
The client SHALL load player marker model and texture assets from the server manifest instead of hardcoded Cubyz asset paths.

#### Scenario: Manifest provides loadable GLB and texture URLs
- **WHEN** player markers are needed and the manifest contains model and texture URLs
- **THEN** the client loads the GLB model and texture, creates active and inactive player marker visuals from them, and updates existing markers

#### Scenario: Manifest or asset loading fails
- **WHEN** the manifest request fails, returns no loadable model, or the referenced model or texture cannot be loaded
- **THEN** the client continues rendering fallback player markers without breaking the world view

### Requirement: Entity model asset contract is documented
The project documentation SHALL describe the player marker manifest contract and the Cubyz 0.3.0 `entityModels` asset layout used by the server and client.

#### Scenario: Contributor reviews asset behavior
- **WHEN** a contributor reads the architecture and client/server specifications
- **THEN** they can identify how player marker model metadata is discovered, which routes are involved, and how fallback behavior works
