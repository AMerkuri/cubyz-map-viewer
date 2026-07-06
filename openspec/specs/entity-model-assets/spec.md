# Entity Model Assets

## Purpose

Define how Cubyz entity model assets are resolved and exposed for map viewer player marker rendering.

## Requirements

### Requirement: Player avatar model resolution
The server SHALL resolve each player's saved avatar model ID from Cubyz player save data and expose the resolved ID in the `/api/players` payload.

#### Scenario: Saved model component resolves to supported avatar
- **WHEN** a player save contains an `entity.components` base64 payload with a `cubyz:model` component whose entity-model palette index resolves to `cubyz:snale`, `cubyz:snail`, `cubyz:moffalo`, or `cubyz:cubert`
- **THEN** the corresponding player object returned by `/api/players` includes that model ID as `entityModelId`

#### Scenario: Saved model component cannot be resolved
- **WHEN** a player save is missing model component data, has malformed component data, has missing palette files, has an out-of-range entity-model palette index, or resolves to an unsupported avatar ID
- **THEN** the corresponding player object returned by `/api/players` includes `entityModelId` set to `cubyz:snale`

#### Scenario: Avatar changes in player save
- **WHEN** the resolved player avatar model ID changes in `players/*.zon`
- **THEN** the server treats the player semantic state as changed and emits the existing `players-updated` invalidation event after the configured debounce flow

### Requirement: Player marker manifest
The server SHALL expose player marker asset manifests derived from layered Cubyz `entityModels` descriptors for supported player avatar model IDs.

#### Scenario: Supported player avatar model is available
- **WHEN** core or save assets contain an `entityModels` descriptor for a requested supported avatar ID tagged `.playerModel` with resolvable model and texture references
- **THEN** the manifest response includes the requested entity model ID, model URL, texture URL, height, and coordinate system

#### Scenario: Supported player avatar model is unavailable
- **WHEN** no layered `entityModels` descriptor for a requested supported avatar ID can be resolved with model and texture assets
- **THEN** the manifest response indicates that no player marker model is available without causing player data loading to fail

#### Scenario: Legacy default player marker manifest is requested
- **WHEN** the existing default player marker manifest route is requested
- **THEN** the server returns the `cubyz:snale` player marker manifest using the same descriptor and asset resolution rules

### Requirement: Layered entity model asset resolution
The server SHALL resolve entity model descriptors, GLB model files, and PNG texture files using the same core-assets-plus-save-overrides precedence used for other layered Cubyz assets.

#### Scenario: Save asset overrides core asset
- **WHEN** both the save assets and core Cubyz assets provide the same namespace-relative entity model descriptor, model, or texture file
- **THEN** the server serves the save asset version for player marker loading

#### Scenario: Referenced asset is missing
- **WHEN** a requested avatar entity model descriptor references a model or texture file that cannot be resolved from layered assets
- **THEN** the server does not return that descriptor as a loadable player marker manifest

### Requirement: Client loads manifest-driven player marker models
The client SHALL load player marker model and texture assets from server manifests keyed by each player's resolved `entityModelId` instead of hardcoded Cubyz asset paths or a single global marker model.

#### Scenario: Manifest provides loadable GLB and texture URLs
- **WHEN** player markers are needed and a player's avatar manifest contains model and texture URLs
- **THEN** the client loads the GLB model and texture for that `entityModelId`, creates active and inactive player marker visuals from them, and updates matching existing markers

#### Scenario: Multiple players use different supported avatars
- **WHEN** visible players have different `entityModelId` values among the supported avatar IDs
- **THEN** the client renders each player with the marker model corresponding to that player's `entityModelId`

#### Scenario: Manifest or asset loading fails
- **WHEN** an avatar manifest request fails, returns no loadable model, or the referenced model or texture cannot be loaded
- **THEN** the client continues rendering fallback player markers without breaking the world view

### Requirement: Player marker avatar facing matches player rotation
The client SHALL render manifest-driven player marker avatar models so their horizontal facing direction matches the player's Cubyz yaw from the `/api/players` rotation payload.

#### Scenario: Player faces a cardinal direction
- **WHEN** `/api/players` returns a player with a supported `entityModelId` and a rotation representing a known horizontal Cubyz facing direction
- **THEN** the rendered avatar marker model faces that same horizontal direction in the world view instead of the opposite direction

#### Scenario: Player rotation changes
- **WHEN** an existing player's rotation changes and the client refreshes player markers after a `players-updated` invalidation or query refresh
- **THEN** the existing marker updates to the new matching horizontal facing direction without recreating unrelated marker state

### Requirement: Entity model asset contract is documented
The project documentation SHALL describe the per-player avatar model resolution, player marker manifest contract, `/api/players` `entityModelId` payload field, and the Cubyz 0.3.0 `entityModels` asset layout used by the server and client.

#### Scenario: Contributor reviews asset behavior
- **WHEN** a contributor reads the architecture and client/server specifications
- **THEN** they can identify how player avatar metadata is decoded, which routes are involved, how model IDs are resolved to assets, and how fallback behavior works
