## Context

Cubyz stores a player's selected avatar as the `cubyz:model` entity component. The `/avatar <entityModel>` command updates this component server-side, and player saves persist it inside `players/<index>.zon` under `entity.components` as URL-safe base64-encoded binary component data. The component payload stores an entity-model palette index, not a plain model ID string.

The current map viewer parses only plain player fields from `players/*.zon`: name, position, rotation, health, energy, spawn position, and server-owned activity state. It exposes those fields from `/api/players` and renders every player using one globally selected player-marker manifest from `/api/assets/player-marker`. That manifest currently prefers `cubyz:snale`, then falls back to the first loadable `.playerModel` descriptor.

Cubyz ships four supported out-of-box player avatars: `cubyz:snale`, `cubyz:snail`, `cubyz:moffalo`, and `cubyz:cubert`. The viewer should treat `cubyz:snale` as its deterministic default whenever saved avatar resolution fails or points at unsupported data.

## Goals / Non-Goals

**Goals:**

- Resolve each player's saved avatar model ID from Cubyz save data without requiring a live Cubyz server API.
- Expose a stable `entityModelId` field in `/api/players` for supported player avatars.
- Serve manifest-driven entity model assets by player avatar model ID while keeping public asset file access narrow and token-based.
- Render active and inactive players with their own avatar models when assets load successfully.
- Preserve current fallback behavior: if model data cannot be decoded or loaded, players remain visible with `cubyz:snale` or fallback dot markers.
- Document the updated player payload and asset contracts.

**Non-Goals:**

- Implement arbitrary entity rendering beyond supported player avatars.
- Support custom third-party avatar IDs beyond the supported `.playerModel` assets unless they are explicitly added later.
- Implement animation, equipment, skin customization, or full Cubyz renderer parity.
- Change Cubyz save formats or require Cubyz-side changes.
- Add UI controls for choosing avatars in the map viewer.

## Decisions

1. Decode player avatar state from existing save files.

   The server parser should read `entity.components`, decode it using URL-safe base64, and parse Cubyz varints in the same sequence used by `main.entity.server.componentsToBase64`: component ID, component version, component-data length, and component data. To find the avatar component, the parser should load `entity_component_palette.zig.zon` and resolve the index for `cubyz:model`; the model component payload then contains a varint entity-model palette index. That index resolves through `entity_model_palette.zig.zon` to a model ID such as `cubyz:cubert`.

   Alternative considered: infer avatars from the last byte of observed component blobs. This works for the examples but is brittle because component IDs and varint lengths can change when palettes grow.

2. Keep supported avatar resolution deterministic and conservative.

   The parser should return `cubyz:snale` when component decoding fails, the palettes are missing, the model component is absent, the model index is out of range, or the resolved model ID is not one of `cubyz:snale`, `cubyz:snail`, `cubyz:moffalo`, or `cubyz:cubert`. This matches the desired viewer default even though Cubyz itself may assign a random player model for newly initialized live players.

   Alternative considered: expose arbitrary resolved IDs and let the client try to load any `.playerModel`. This is more flexible but broadens the route surface and makes fallback behavior less predictable.

3. Extend the asset service from one player-marker manifest to model-ID manifests.

   `EntityModelAssetService` should still scan layered `entityModels/**/*.zig.zon` descriptors and resolve GLB/PNG assets through core assets plus save overrides. Instead of caching only one selected manifest, it should be able to produce a manifest for a requested supported player avatar ID. File serving should remain token-based: manifest generation registers only the model/texture files needed for supported avatars, and `/api/assets/entity-models/files/:token` continues to reject unknown tokens.

   Alternative considered: add a generic `/api/assets/:namespace/*` filesystem proxy. That would simplify client URL construction but would expose a much wider public file-serving surface than this feature needs.

4. Load and cache avatar templates per entity model ID in the world view runtime.

   The Three.js runtime should maintain imperative refs/maps keyed by `entityModelId` for load state, normalized model template, active texture, and inactive grayscale texture. `syncPlayerMarkers` can recreate a marker when the player's avatar ID changes or when the model becomes available. Per-frame state should stay out of React state.

   Alternative considered: keep one global marker template and swap only textures. That cannot support avatars with different GLB geometry or coordinate systems.

5. Preserve fallback marker visibility independently per player.

   A missing or failed avatar asset should not prevent rendering the player marker. The renderer should fall back to the existing dot/label marker for that player or use the default `cubyz:snale` assets when available. Active/inactive grayscale behavior should remain tied to `player.isActive` regardless of avatar.

   Alternative considered: block player marker updates until all avatar models load. This would make failures or slow assets hide unrelated players.

## Risks / Trade-offs

- Cubyz component binary decoding diverges from future Cubyz versions -> Keep the decoder narrow, tolerant, and fallback to `cubyz:snale` on unreadable data.
- Palette files are missing or stale relative to player files -> Treat resolution failure as default avatar rather than failing `/api/players`.
- Multiple avatar GLBs increase memory and network cost -> Load only avatars present in current players or requested by the scene, cache templates by model ID, and continue using fallback markers during loading.
- Asset route cache/token state becomes inconsistent -> Generate manifests through the service and keep file tokens opaque and service-owned.
- Player avatar changes may not trigger updates if semantic signatures ignore `entityModelId` -> Include resolved avatar ID in the server-side player semantic signature used before broadcasting `players-updated`.
- Documentation drift for route and payload contracts -> Update architecture, server, and client docs as part of implementation.

## Migration Plan

- Existing saves without model components continue to render with `cubyz:snale`.
- Existing clients receive one additional `entityModelId` field in player payloads; this is additive.
- The old `/api/assets/player-marker` route can remain as a default `cubyz:snale` compatibility path or be internally implemented through the new by-ID resolver, avoiding a hard break for current client code during the implementation transition.

## Open Questions

- Should unsupported but valid `.playerModel` IDs from save overrides ever be allowed, or should the first version strictly limit rendering to the four supported out-of-box avatars?
- Should failed avatar asset loads retry once per model ID as the current global player marker loader does, or use a longer-lived failure cache to avoid repeated requests?
