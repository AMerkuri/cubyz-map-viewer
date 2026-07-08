## Why

The avatar resolver hardcodes a four-model allowlist (`cubyz:snale`, `cubyz:snail`, `cubyz:moffalo`, `cubyz:cubert`), so players using custom or save-level avatars (e.g., `skinz:darkknight`, `skinz:evilcubert`, `skinz:redsnale`) always fall back to `cubyz:snale` in the map viewer even though their descriptors are already loadable by the manifest service. The downstream layers already handle unknown and missing models gracefully, making this resolver-level allowlist a redundant gatekeeper that prevents legitimate custom avatars from rendering.

## What Changes

- Remove the hardcoded `SUPPORTED_AVATAR_MODEL_IDS` allowlist from `resolveAvatarModelId` in `src/server/parsers/player-avatar.ts`.
- Have the resolver return whatever the entity-model palette resolves to, falling back to `cubyz:snale` only when component/palette decode fails or the palette index is out of range.
- Update the "Saved model component cannot be resolved" scenario in the `entity-model-assets` spec to no longer list "unsupported avatar ID" as a fallback trigger — unknown IDs now flow through to the manifest service.
- Update docs to reflect that any descriptor carrying the `playerModel` tag is eligible for rendering, not just the four vanilla Cubyz models.

## Capabilities

### New Capabilities

(None — no new capabilities introduced.)

### Modified Capabilities

- `entity-model-assets`: The player avatar model resolution requirement changes so any palette-resolved model ID is forwarded to the manifest service rather than being rejected by a hardcoded allowlist. The "Saved model component cannot be resolved" scenario is narrowed to decode/palette failures only.

## Impact

- **Affected code**: `src/server/parsers/player-avatar.ts` (allowlist removal + deduplication of the now-shared default constant); minor reference cleanup in `src/server/services/entity-model-assets.ts` if the `SUPPORTED_PLAYER_MODEL_IDS` allowlist is also relaxed for consistency.
- **APIs**: No HTTP/WebSocket contract changes. `/api/players` continues to return `entityModelId` strings; clients continue to fetch `/api/assets/player-marker/:entityModelId`. The set of valid IDs simply widens.
- **Client behavior**: The client avatar asset cache (`src/client/features/world-view/lib/avatar-assets.ts`) already handles `manifest.available === false` gracefully; no client changes required.
- **Shared contracts**: The player data `entityModelId` field semantics are unchanged — it remains a string. The fallback path narrows but the contract is identical.
- **Documentation**: `docs/client-specification.md` and `docs/server-specification.md` references to a "supported avatars" allowlist must be updated to describe tag-based resolution. `docs/architecture-overview.md` may need a minor note if it enumerates the four model IDs.
- **Verification**: `npm run check && npm run check:knip && npm run typecheck`. No build/boundary changes; build not required.
