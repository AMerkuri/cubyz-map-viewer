## Context

The map viewer has a two-stage avatar pipeline:

1. **Resolver** (`src/server/parsers/player-avatar.ts`): decodes the `cubyz:model` component from a player save file, looks up the entity-model palette, and returns a model ID. Falls back to `cubyz:snale` on any failure.
2. **Manifest service** (`src/server/services/entity-model-assets.ts`): scans all `entityModels/**/*.zig.zon` descriptors, keeps any tagged `.playerModel` or in a hardcoded allowlist, and serves `/api/assets/player-marker/:entityModelId` manifests with GLB/texture URLs.
3. **Client** (`src/client/features/world-view/lib/avatar-assets.ts`): fetches manifests, loads GLB+PNG, and renders markers. Falls back to `cubyz:snale` when `manifest.available === false` or asset loads fail.

The resolver currently enforces a hardcoded four-model allowlist (`cubyz:snale`, `cubyz:snail`, `cubyz:moffalo`, `cubyz:cubert`). Any palette-resolved ID outside that set is rewritten to `cubyz:snale` before the manifest service is ever consulted. This blocks legitimately tagged custom avatars (e.g., `skinz:darkknight` after the community `..playermodel` → `.playerModel` syntax fix) from reaching the rendering pipeline, even though the manifest service and the client both already handle unknown or unavailable models gracefully.

The manifest service's own allowlist (`SUPPORTED_PLAYER_MODEL_IDS` in `entity-model-assets.ts:46-51`) serves a different purpose: it lets vanilla Cubyz models be registered even when they lack the `.playerModel` tag, because Cubyz's in-game `/avatar` command can assign any model. That backstop is intentional and should remain.

## Goals / Non-Goals

**Goals:**
- Allow any palette-resolved avatar model ID to reach the manifest service and the client, so tag-bearing custom models render as player markers.
- Keep the existing fallback chain intact: decode failure → `cubyz:snale`; unknown/unavailable ID at manifest service → `UNAVAILABLE_MANIFEST` → client falls back to `cubyz:snale`.
- Preserve the `playerModel` tag as the real gatekeeper for which descriptors become player markers.
- Keep HTTP/WebSocket/`entityModelId` payload contracts unchanged.

**Non-Goals:**
- Removing the `SUPPORTED_PLAYER_MODEL_IDS` backstop in `entity-model-assets.ts` — that backstop exists for vanilla models that may lack the tag in save-overridden forms and stays out of scope.
- Changing the manifest service descriptor loading or filtering logic (it already accepts any tagged descriptor).
- Modifying client fallback behavior (already correct for unavailable manifests).
- Adding logging, metrics, or configuration for which avatars render — no observability changes.
- Touching voxel mesh workers, route shapes, or the React marker component tree.

## Decisions

### Decision 1: Remove the resolver allowlist; trust the palette lookup

`resolveAvatarModelId` returns whatever the entity-model palette resolves the varint index to. The only remaining failure modes are: missing component data, decode failures, missing palette files, and out-of-range palette indices — all of which still fall back to `cubyz:snale`.

**Rationale**: The resolver is a pure palette-decode layer; it has no business judging whether a model ID is "supported" because the manifest service is the source of truth for that. The client already falls back gracefully on `available: false`, making the resolver's allowlist a redundant double-filter.

**Alternatives considered**:
- *Inject `EntityModelAssetService` into the resolver* so it can ask "is this available?" before returning the ID. Rejected: makes the resolver async, couples parsers/ to services/, and just shifts the same check one layer up without changing the outcome — the client still needs to handle `available: false` for races (descriptor added/removed between resolve and fetch).
- *Configurable env allowlist* (`PLAYER_AVATAR_ALLOWLIST=...`). Rejected: defeats dynamic discovery and forces users to maintain model ID lists by hand.
- *Keep the resolver allowlist, just add `skinz:*` to it*. Rejected: whack-a-mole; every new community mod would need a code change.

### Decision 2: Keep the manifest service's `SUPPORTED_PLAYER_MODEL_IDS` backstop

`EntityModelAssetService.loadPlayerModelDescriptors` (`src/server/services/entity-model-assets.ts:157-166`) keeps a descriptor if `tags.has("playerModel")` OR the ID is in `SUPPORTED_PLAYER_MODEL_IDS`. This backstop stays unchanged.

**Rationale**: The backstop exists for a specific Cubyz behavior — the `/avatar` command can assign any entity model to a player, including vanilla models that may not be tagged `.playerModel` in the install. Removing the backstop would break vanilla-model fallback for such players. Custom models opt in via the tag, which is the intended Cubyz convention.

### Decision 3: Doc updates use "tag-bearing or backstop" wording

`docs/server-specification.md:65-66,76`, `docs/architecture-overview.md:94,100-101,107-108`, and `docs/client-specification.md:53-54` mention a "supported avatar" set in ways that now overstate the resolver's role. These need rewriting to describe the actual filter location: the resolver returns any palette-resolved ID, the manifest service serves tagged descriptors (plus vanilla backstop), and the client falls back on unavailable manifests.

**Rationale**: AGENTS.md requires docs to stay in sync with behavior. The contract (field name, field type, route shape) is unchanged; only the prose describing the filter location needs updating.

### Decision 4: No spec scenario additions

The `entity-model-assets` capability already has the right scenarios — "Supported player avatar model is available" and "Supported player avatar model is unavailable" cover both outcomes. The spec change is a delta to the "Saved model component cannot be resolved" scenario, narrowing its fallback triggers from "missing/malformed/unavailable-palettes/out-of-range/unsupported ID" to "missing/malformed/unavailable-palettes/out-of-range". The supported/unavailable scenarios still apply because custom models flow through them unchanged.

## Risks / Trade-offs

- **[Non-player models leak as `entityModelId`]** If a player's component data somehow resolves to a mob or NPC model ID (e.g., via a misbehaving mod that wrote a non-player index), `/api/players` will now surface that ID instead of silently rewriting it to `cubyz:snale`. **Mitigation**: The manifest service returns `UNAVAILABLE_MANIFEST` for any ID that has no tagged descriptor or resolvable assets, and the client falls back to `cubyz:snale`. End-to-end behavior for end users is unchanged; the only difference is that the surfaced `entityModelId` string is the true palette value rather than the rewritten default. This is more honest and easier to debug.
- **[Path traversal / model ID injection]** `/api/assets/player-marker/:entityModelId` already validates the ID against `ENTITY_MODEL_ID_PATTERN` (`/^[A-Za-z0-9._-]+:[A-Za-z0-9._/-]+$/`) and `parseNamespacedRef` rejects `..` path segments. No new attack surface is introduced.
- **[Descriptor scan cost]** The manifest service already scans all `entityModels/**/*.zig.zon` files at startup; widening the resolver allowlist does not increase scan cost. Per-request cost is unchanged (manifest lookup is `Map.get`).
- **[Semantic signature churn]** `createPlayerSemanticSignature` already includes `entityModelId` in the snapshot, so a player whose previously-rewritten `cubyz:snale` now resolves to `skinz:darkknight` will trigger a `players-updated` WebSocket event on the next reload. This is the intended behavior — the semantic snapshot now reflects truth.
- **[Docs drift]** If docs are not updated in lockstep, contributors will see the resolver returning IDs the docs say it shouldn't. **Mitigation**: Tasks list includes the doc updates as a required step.
