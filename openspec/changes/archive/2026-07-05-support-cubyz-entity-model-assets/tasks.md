## 1. Server Asset Manifest

- [x] 1.1 Add entity model descriptor parsing for `entityModels/**/*.zig.zon` using the existing ZON parser and layered asset namespace sources.
- [x] 1.2 Implement deterministic player model selection: prefer loadable `cubyz:snale` tagged `.playerModel`, otherwise first loadable `.playerModel` descriptor by stable ID.
- [x] 1.3 Resolve descriptor `model`, `defaultTexture`, `height`, and `coordinateSystem` fields into a player marker manifest payload.
- [x] 1.4 Add strict server routes for the player marker manifest and referenced `entityModels` model/texture files without exposing arbitrary filesystem paths.
- [x] 1.5 Preserve fallback semantics by returning a non-fatal no-model response when no loadable player model descriptor exists.

## 2. Client Player Marker Loading

- [x] 2.1 Replace hardcoded Snale OBJ/PNG loading with a manifest request from the server.
- [x] 2.2 Switch player marker model loading from `OBJLoader` to Three.js `GLTFLoader` for GLB assets.
- [x] 2.3 Adapt loaded GLB scenes into the existing player marker template lifecycle, disposal, active/inactive texture handling, and retry behavior.
- [x] 2.4 Apply marker normalization using manifest metadata, including height and coordinate system, while keeping per-frame scene state out of React state.
- [x] 2.5 Verify asset-load failures still render fallback dot markers and do not break player label updates.

## 3. Documentation

- [x] 3.1 Update `docs/architecture-overview.md` with the entity model asset discovery and manifest flow.
- [x] 3.2 Update `docs/server-specification.md` with the new asset manifest and entity model file-serving contract.
- [x] 3.3 Update `docs/client-specification.md` with manifest-driven player marker loading and fallback behavior.

## 4. Verification

- [x] 4.1 Run `npm run check`.
- [x] 4.2 Run `npm run check:knip`.
- [x] 4.3 Run `npm run typecheck`.
- [x] 4.4 Run `npm run build` because this changes route payloads and client TypeScript boundaries.
