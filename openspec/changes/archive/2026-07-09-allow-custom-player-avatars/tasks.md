## 1. Resolver allowlist removal

- [x] 1.1 In `src/server/parsers/player-avatar.ts`, remove the `SUPPORTED_AVATAR_MODEL_IDS` constant and the `supportedAvatarIds` set.
- [x] 1.2 Update `resolveAvatarModelId` so the final `supportedAvatarIds.has(modelId)` check returns the palette-resolved `modelId` verbatim when it is a string, instead of falling back to `cubyz:snale` for IDs outside the allowlist. Keep the existing fallback for non-string/out-of-range palette entries.
- [x] 1.3 Remove any now-unused imports or helpers introduced solely by the allowlist (verify with `npm run check:knip`).

## 2. Documentation updates

- [x] 2.1 Update `docs/server-specification.md` lines 65-66 to describe the manifest service filter as accepting any descriptor tagged `.playerModel` plus the vanilla `SUPPORTED_PLAYER_MODEL_IDS` backstop, without implying resolver-level allowlisting.
- [x] 2.2 Update `docs/server-specification.md` line 76 to remove "or the resolved ID is not a supported avatar" as a `resolveAvatarModelId` fallback trigger; remaining triggers are missing component data, malformed data, missing palettes, and out-of-range palette index.
- [x] 2.3 Update `docs/architecture-overview.md` lines 94, 100-101, 107-108 so the avatar resolution prose describes tag-based manifest filtering rather than a four-model allowlist at the resolver.
- [x] 2.4 Update `docs/client-specification.md` lines 53-54 to clarify that the client may receive arbitrary `entityModelId` strings and falls back per-manifest, rather than the resolver pre-filtering to a supported set.
- [x] 2.5 Confirm `docs/architecture-overview.md` does not require shared-contract updates beyond the avatar resolution prose (no new routes, events, fields, or coordinate/LOD/compression changes).

## 3. Verification

- [x] 3.1 Run `npm run check && npm run check:knip && npm run typecheck` and resolve any failures.
- [x] 3.2 Confirm no build/boundary, worker, or route-payload changes were made; if so, run `npm run build`.
