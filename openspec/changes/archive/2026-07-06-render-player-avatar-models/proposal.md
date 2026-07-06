## Why

The viewer currently renders every player with one global player marker model, even though Cubyz persists each player's selected avatar in the saved `cubyz:model` entity component. Players using supported avatars such as `cubyz:cubert`, `cubyz:snail`, or `cubyz:moffalo` should be recognizable on the map instead of all appearing as the same default model.

## What Changes

- Decode saved player `entity.components` data to identify the `cubyz:model` entity model index.
- Resolve the decoded model index through `entity_model_palette.zig.zon` and expose the resolved `entityModelId` on `/api/players`.
- Default player avatar resolution to `cubyz:snale` when the component data is missing, malformed, out of range, or references an unsupported/unloadable avatar.
- Extend entity model asset serving so the client can load player marker assets by model ID instead of relying on one global player-marker manifest.
- Render each player with their resolved supported avatar model while preserving inactive grayscale styling and fallback dot behavior when assets cannot load.
- Update shared client/server documentation for the changed player payload and asset route contracts.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `entity-model-assets`: Change the player marker asset contract from a single selected global model to resolving and serving supported player avatar models by entity model ID.

## Impact

- Server player parsing: `src/server/parsers/player.ts` needs to decode Cubyz component base64 and read `entity_model_palette.zig.zon` / `entity_component_palette.zig.zon`.
- Server assets: `src/server/services/entity-model-assets.ts` and `src/server/api/assets.ts` need per-model manifest/file resolution for supported player avatars.
- Client data contract: `PlayerData` gains a resolved `entityModelId` field from `/api/players`.
- Client rendering: `World3DView.tsx` and marker helpers need to cache/load model templates per avatar and select the right template for each player.
- Documentation: `docs/architecture-overview.md`, `docs/server-specification.md`, and `docs/client-specification.md` need updates for the shared player/avatar contract.
