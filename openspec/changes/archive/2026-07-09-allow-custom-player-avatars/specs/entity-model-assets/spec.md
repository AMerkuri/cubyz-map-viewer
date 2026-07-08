## MODIFIED Requirements

### Requirement: Player avatar model resolution
The server SHALL resolve each player's saved avatar model ID from Cubyz player save data and expose the resolved ID in the `/api/players` payload. Resolution MUST NOT filter the palette-resolved model ID against a hardcoded set of supported avatar IDs; any ID resolved from the entity-model palette SHALL be forwarded as the player's `entityModelId` so the manifest service and client can decide availability using descriptor tags and asset resolution.

#### Scenario: Saved model component resolves to a palette ID
- **WHEN** a player save contains an `entity.components` base64 payload with a `cubyz:model` component whose entity-model palette index resolves to any model ID string present in `entity_model_palette.zig.zon` (including but not limited to `cubyz:snale`, `cubyz:snail`, `cubyz:moffalo`, `cubyz:cubert`, `skinz:darkknight`, `skinz:evilcubert`, or `skinz:redsnale`)
- **THEN** the corresponding player object returned by `/api/players` includes that resolved model ID verbatim as `entityModelId`

#### Scenario: Saved model component cannot be resolved
- **WHEN** a player save is missing model component data, has malformed component data, has missing palette files, or has an out-of-range entity-model palette index
- **THEN** the corresponding player object returned by `/api/players` includes `entityModelId` set to `cubyz:snale`

#### Scenario: Avatar changes in player save
- **WHEN** the resolved player avatar model ID changes in `players/*.zon`
- **THEN** the server treats the player semantic state as changed and emits the existing `players-updated` invalidation event after the configured debounce flow

### Requirement: Player marker manifest
The server SHALL expose player marker asset manifests derived from layered Cubyz `entityModels` descriptors for player avatar model IDs requested by the client, regardless of whether the ID is in a hardcoded list. A manifest SHALL be considered available only when a descriptor tagged `.playerModel` (or backstopped by the vanilla `SUPPORTED_PLAYER_MODEL_IDS` set) can be resolved with model and texture assets.

#### Scenario: Tagged player avatar model is available
- **WHEN** core or save assets contain an `entityModels` descriptor for a requested avatar ID tagged `.playerModel` with resolvable model and texture references (including custom namespaces like `skinz:`)
- **THEN** the manifest response includes the requested entity model ID, model URL, texture URL, height, and coordinate system

#### Scenario: Player avatar model is unavailable
- **WHEN** no layered `entityModels` descriptor for a requested avatar ID can be resolved with model and texture assets, the descriptor is not tagged `.playerModel` and not backstopped by the vanilla set, or the referenced model/texture files are missing
- **THEN** the manifest response indicates that no player marker model is available without causing player data loading to fail, and the client falls back to the default avatar `cubyz:snale`

#### Scenario: Legacy default player marker manifest is requested
- **WHEN** the existing default player marker manifest route is requested
- **THEN** the server returns the `cubyz:snale` player marker manifest using the same descriptor and asset resolution rules
