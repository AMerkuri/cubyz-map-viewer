## Context

The current player marker loader in `World3DView.tsx` directly requests Snale from the Cubyz 0.2.x asset layout: `entities/models/snale.obj` and `entities/textures/snale.png`. Cubyz 0.3.0 removed those OBJ files and moved entity visuals into `entityModels`, where `.zig.zon` descriptors define model IDs, default texture IDs, height, coordinate system, and tags such as `.playerModel`.

The server already discovers layered asset namespace sources from core Cubyz assets and save overrides. That layering should remain the authority for resolving Cubyz asset files. The browser should not need to know the on-disk layout beyond URLs returned by the server.

## Goals / Non-Goals

**Goals:**

- Expose a stable player marker asset manifest from the server.
- Discover player-capable entity models from `entityModels/*.zig.zon`, preferring descriptors tagged `.playerModel`.
- Resolve descriptor-referenced model and texture files through layered asset sources, including save overrides.
- Load Cubyz 0.3.0 GLB entity model assets in the Three.js scene while preserving fallback markers when model assets cannot be loaded.
- Document the new client/server asset contract.

**Non-Goals:**

- Render all Cubyz entity types or live entity component state.
- Implement full Cubyz model rendering parity, animation, lighting, or equipment rendering.
- Add user-facing controls for choosing a player model.
- Remove fallback dot markers.
- Support arbitrary nested asset file paths in public routes unless explicitly required by the manifest.

## Decisions

1. Add a manifest endpoint for player marker assets.

   The server will provide a JSON manifest, for example `/api/assets/player-marker`, containing the selected entity model ID, model URL, texture URL, height, coordinate system, and source metadata needed by the client. The client loads only the URLs from this manifest.

   Alternative considered: hardcode `/api/assets/entityModels/models/snale.glb` and `/api/assets/entityModels/textures/snale.png` in the client. This is smaller but repeats the 0.2.x mistake: the next Cubyz asset rename or player model choice would break the viewer again.

2. Parse entity model descriptors server-side.

   The server will read layered `entityModels/**/*.zig.zon` descriptors using the existing ZON parser and asset namespace source model. Descriptors tagged `.playerModel` are candidates. The preferred selection is deterministic: use `cubyz:snale` when present and tagged as a player model, otherwise use the first available player model sorted by stable ID, otherwise return no manifest payload or a not-found response that lets the client keep fallback markers.

   Alternative considered: require a configured player model ID. That may become useful later, but it is unnecessary for restoring default behavior and would add configuration surface before there is a user need.

3. Keep routes manifest-addressable rather than broad filesystem proxies.

   Model and texture routes should resolve safe asset identifiers or manifest-generated tokens to layered files under `entityModels/models` and `entityModels/textures`. They should not expose arbitrary path traversal or unrestricted filesystem reads.

   Alternative considered: expose a generic `/api/assets/:namespace/*` route. That is flexible but broadens the public file-serving surface more than this change needs.

4. Use Three.js `GLTFLoader` for GLB models.

   Cubyz 0.3.0 entity models are `.glb`, so the client should replace the OBJ-specific player marker load path with `GLTFLoader`. No new npm package should be needed because the loader ships with the existing `three` package.

   Alternative considered: convert GLB to OBJ on the server. That would add complexity, lose metadata, and move rendering concerns into the server.

5. Apply model normalization in the player marker creation path.

   The client should keep scene state imperative and contained in the world-view runtime. Any scale, vertical offset, rotation, and coordinate-system adjustment for the marker template should be applied when preparing or cloning the loaded marker model, not through React state.

   Alternative considered: ignore coordinate system metadata. That may load something visible, but Snale declares `.left_handed_y_up`, so orientation regressions are likely without an explicit normalization check.

## Risks / Trade-offs

- GLB orientation differs from Cubyz rendering -> Use descriptor `coordinateSystem`, height, and visual verification to normalize the marker, while preserving fallback markers if loading fails.
- Descriptor parsing misses valid Cubyz ZON syntax -> Reuse the existing tolerant ZON parser and keep parsing narrow to fields required for the manifest.
- Save overrides and core assets disagree -> Preserve existing asset-source precedence so later sources override earlier ones consistently with biome/block asset loading.
- Public asset routes become too permissive -> Keep validation strict and resolve only known `entityModels` model/texture files required by the manifest.
- Older Cubyz 0.2.x installs lose model markers -> Prefer the new 0.3.0 manifest path, but keep fallback dot markers. Optional 0.2.x compatibility can be considered separately if explicitly needed.
