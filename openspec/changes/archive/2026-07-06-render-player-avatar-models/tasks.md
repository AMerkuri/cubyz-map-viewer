## 1. Server Avatar Resolution

- [x] 1.1 Add a narrow Cubyz component binary decoder for URL-safe base64 component streams using Cubyz varint and sized-slice encoding.
- [x] 1.2 Load `entity_component_palette.zig.zon` and `entity_model_palette.zig.zon` for the active save and resolve the `cubyz:model` component ID and entity model palette entries.
- [x] 1.3 Extend player parsing to expose `entityModelId`, defaulting to `cubyz:snale` for missing, malformed, unsupported, or out-of-range data.
- [x] 1.4 Include `entityModelId` in the player semantic signature so avatar-only save changes trigger `players-updated`.

## 2. Server Asset Manifests

- [x] 2.1 Extend `EntityModelAssetService` to resolve manifests for supported avatar IDs: `cubyz:snale`, `cubyz:snail`, `cubyz:moffalo`, and `cubyz:cubert`.
- [x] 2.2 Keep entity model file serving token-based and register only files referenced by generated avatar manifests.
- [x] 2.3 Add an asset API route for requesting a player marker manifest by entity model ID while preserving the existing default `cubyz:snale` route behavior.
- [x] 2.4 Ensure missing or unloadable avatar assets return an unavailable manifest without failing `/api/players`.

## 3. Client Player Rendering

- [x] 3.1 Add `entityModelId` to the client `PlayerData` contract and any player UI that displays or keys player data as needed.
- [x] 3.2 Refactor player marker asset loading in `World3DView.tsx` to cache load state, normalized templates, active textures, and inactive grayscale textures by `entityModelId`.
- [x] 3.3 Update marker synchronization so each player uses the model for their own `entityModelId`, recreating marker visuals when a player's avatar ID changes.
- [x] 3.4 Preserve fallback dot markers and active/inactive styling when a specific avatar manifest or asset fails to load.

## 4. Documentation

- [x] 4.1 Update `docs/architecture-overview.md` with the `/api/players` `entityModelId` field, avatar decoding source, and per-avatar manifest contract.
- [x] 4.2 Update `docs/server-specification.md` with palette/component decoding, supported avatar fallback behavior, and asset routes.
- [x] 4.3 Update `docs/client-specification.md` with per-player avatar loading, caching, and fallback rendering behavior.

## 5. Verification

- [x] 5.1 Run `npm run check`.
- [x] 5.2 Run `npm run check:knip`.
- [x] 5.3 Run `npm run typecheck`.
- [x] 5.4 Run `npm run build` because this changes route payloads and TypeScript client/server boundaries.
