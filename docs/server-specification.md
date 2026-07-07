# Server Specification

## Scope

This document covers server-owned architecture and runtime behavior. Shared contracts such as coordinates, LODs, and WebSocket event names live in `docs/architecture-overview.md`.

## Composition Root

- `src/server/index.ts` is the only real startup/composition file.
- It resolves `SAVE_PATH` / `CUBYZ_PATH` from env or CLI args, auto-detects the newest save under `~/.cubyz/saves/` when `SAVE_PATH` is unset, and expects the parent of this repo to contain `assets/cubyz` when `CUBYZ_PATH` is unset.
- It loads world metadata, palettes, layered asset namespaces, biome definitions, the color map, block shape metadata, and the voxel mesh service before starting HTTP/WebSocket serving.
- It serves the built client only when `dist/client/index.html` exists; otherwise the process runs API-only.
- It starts `SaveWatcher`, wires WebSocket broadcasting, and can optionally warm the voxel cache on startup.

## Layering

- `src/server/api/`: parameter validation, HTTP caching/status codes, and route wiring
- `src/server/parsers/`: Cubyz file-format decoding only
- `src/server/services/`: color mapping, terrain payload generation, watcher logic, logging, caches, and voxel orchestration
- `src/server/workers/`: voxel worker entrypoints and protocol

Keep this layering real. In particular, voxel routes should go through `VoxelMeshService`, not around it.

## Route Surface

- `/api/world`, `/api/world/surface-index`, `/api/world/chunk-index`, `/api/world/block-palette`: bootstrap world, index, and save block palette data
- `/api/players`: parsed player data with server-owned `isActive` and resolved `entityModelId`
- `/api/terrain/:lod/:x/:y`: seam-safe terrain JSON built from the same-LOD 3x3 surface neighborhood; cached with ETag
- `/api/biomes/:lod/:x/:y`: grouped biome-label regions from `.surface` data
- `/api/voxels/:lod/:regionX/:regionY`: binary voxel mesh payloads with explicit `br`/`gzip` negotiation, ETags, and queue/timing headers
- `/api/signs/:lod/:regionX/:regionY`: per-region sign records as JSON, routed through `VoxelMeshService`; returns an empty array for regions without signs and for coarser LODs (`> 1`)
- `/api/assets/player-marker`: default `cubyz:snale` player marker asset manifest derived from layered `entityModels` descriptors
- `/api/assets/player-marker/:entityModelId`: player marker asset manifest for a specific supported avatar model ID
- `/api/assets/entity-models/files/:token`: opaque, manifest-addressable GLB/PNG entity model asset serving; tokens resolve only files registered by a player marker manifest
- `/api/health`: simple liveness endpoint

## Voxel Pipeline

- `VoxelMeshService` owns in-memory caching, in-flight dedupe, stale-result protection, and encoded response variants.
- `VoxelWorkerPool` runs the TypeScript worker through `src/server/workers/voxel-worker-dev.js` in dev and the built worker from `dist/server/workers/` in production.
- Global Express compression explicitly skips `/api/voxels`; that route negotiates and caches its own compressed variants.
- Voxel compression settings are configured once at startup and applied when each encoded variant is first generated. The default tuning is Brotli `quality=6`, `lgwin=11`, and gzip `level=3`.
- The voxel generator keeps the binary layout compact by reusing the existing per-quad AO byte for LOD `1/2` top faces and concave vertical wall corners instead of adding a separate wall-lighting payload.
- The voxel generator encodes vertex X/Y/Z as `u32` fixed-point coordinates in `1/4096` voxel-cell units relative to the response origin, preserving supported OBJ block model vertices as authored block-local coordinates, including coordinates outside the `0..1` unit-block range, while preserving exact full-cube boundaries.
- The voxel generator writes a padded `u16` per-quad block palette index section after the winding flags, followed by a padded `u8` render-kind section before vertex positions. Palette values resolve through `/api/world/block-palette`; out-of-range indices are encoded as `0xFFFF` so the client omits block identity instead of guessing. Render kind `1` is opaque and render kind `2` is transparent.
- Full-cube blocks, including block definitions whose model reference is explicitly `cubyz:cube`, use exterior traversal plus greedy merged cube faces. Air remains traversable and non-renderable, opaque cube blocks stop traversal and emit opaque boundary faces, and transparent renderable cube blocks are traversable while emitting transparent faces. Adjacent transparent blocks with the same block ID/visual group skip their shared internal faces, suppress duplicate same-plane transparent cells, greedily merge matching exterior faces, and encode transparent AO as zero so connected panes read as one continuous volume even if the save palette contains duplicate entries; boundaries between different transparent block IDs remain visible.
- Supported rotation semantic shapes are handled server-side. `cubyz:stairs` decodes the low 8 block-data bits as removed 2x2x2 sub-block octants and keeps data `0` on the full-cube fast path; `cubyz:fence` emits center posts plus saved horizontal connection arms for fences, walls, and bars; `cubyz:branch` emits center and six-direction branch arms from saved connection bits; `cubyz:carpet`, `cubyz:sign`, `cubyz:hanging`, and selected `cubyz:direction` blocks select finite model variants from block data.
- `cubyz:sign` block data uses the Cubyz 20-state layout: data `0..7` selects the floor model rotated in eight 45-degree Z increments, data `8..15` selects the ceiling model rotated in the same eight 45-degree increments, and data `16..19` attaches the side model to the `-X`, `-Y`, `+X`, and `+Y` faces respectively. Floor and ceiling rotation uses an eighth-turn (45-degree) transform about the block center rather than quarter turns, so all eight orientations are distinct.
- `cubyz:texture_pile` blocks (for example `cubyz:red_leaf_pile`, `cubyz:dead_leaf_pile`, `cubyz:yellow_leaf_pile`, and `cubyz:duckweed`) parse `.model = .{ .model = <model-ref>, .states = <count> }` and render the referenced plane model geometry instead of a full cube. The block color continues to come from the palette entry; the saved state count is clamped to the Cubyz `2..16` range, and block data outside the state count is clamped to a valid finite state without failing mesh generation. Texture-pile blocks honor `lodReplacement` (typically `cubyz:air`) at higher LODs.
- Higher LOD non-cube and semantic blocks use `lodReplacement` when it resolves to a palette entry; otherwise they fall back to the documented safe cube/air fallback shape instead of emitting tiny model geometry.
- Sign text is served through `VoxelMeshService.getSignRecords(lod, regionX, regionY)`, which decodes signs from `.region` block-entity streams and joins them with the block shape table. Sign records are gated to LOD `1`; other LODs return an empty array. The binary voxel mesh payload stays geometry-only; sign records are served exclusively through `/api/signs`.
- The region parser (`parsers/region.ts`) decodes the block-entity stream that trails entity-carrying chunk blobs (`uniform`, `deflate`, `deflate_with_8bit_palette`) instead of skipping it; legacy `*_no_block_entities` algorithms have no trailing stream. Each block-entity stream is an optional leading `u8` algorithm byte (`0` = raw, present only when non-empty) followed by records of a big-endian `u16` position index (`u15` packed `(x << 10) | (y << 5) | z` within the 32^3 chunk), a LEB128 varint payload length, and that many raw bytes. Parsing is defensive: every read is bounds-checked against the blob end and truncation returns the records already parsed without throwing. Records are returned as raw `{ positionIndex, payload }` on `ChunkData.entities`; sign classification, UTF-8 validation, orientation extraction, world position, and text-plane corners happen in the service layer, keeping the parser a pure format decoder.
- Each sign record contains `position` (world block minimum corner), `data` (orientation `0-19`), `text` (UTF-8, `\n` preserved), and four world-space `corners` describing the text plane. Corners are derived from the same sign geometry used to place the board (`getSignQuads()` orientation logic), so the text plane stays coplanar with the sign face. Non-sign block entities and invalid-UTF-8 or empty-text records produce no sign record.
- Persistent voxel mesh cache keys include `VOXEL_GENERATOR_CACHE_VERSION` and the block shape table signature. The shape table signature includes a semantic support version plus shape-affecting block definition/model inputs (including texture-pile model references, state counts, and supported OBJ coordinate interpretation), so semantic implementation, asset, or model-coordinate interpretation changes invalidate stale meshes. When the voxel generator changes geometry, traversal semantics, transparent classification, or binary payload semantics, `VOXEL_GENERATOR_CACHE_VERSION` is bumped so previously persisted meshes are regenerated rather than reused.

## Assets And Overrides

- Asset lookup is layered: the server reads base assets from `CUBYZ_PATH/assets/*` and allows `SAVE_PATH/assets/*` to override matching namespace-relative files.
- That layered lookup is used for biome/block assets and entity model descriptor/model/texture resolution.
- `BlockShapeTable` scans `blocks/**/*.zig.zon`, applies inherited `_defaults.zig.zon` values by directory, resolves static `.model` references against `assets/*/models/*.obj`, and records palette-indexed cube, air, supported model, or supported semantic shapes. Supported OBJ vertices are interpreted directly as authored block-local coordinates, so oversized model bounds are preserved instead of inferred as `0..16` voxel units. A direct `cubyz:cube` model reference is normalized back to the cube shape so cube-like transparent blocks can use greedy connected-face meshing. For `cubyz:texture_pile` it reads the nested `.model.model` reference as the base geometry and the `.model.states` count as finite state metadata.
- `ColorMapService` scans layered block definitions with inherited `_defaults.zig.zon` values and records palette-indexed block visual metadata: air, opaque renderable, transparent renderable, and same-block transparent connection groups. Transparent metadata uses Cubyz fields such as `.transparent`, `.hasBackFace`, `.absorbedLight`, and texture absorption fallbacks; `cubyz:glass/` IDs are not treated as air solely by prefix.
- Supported static/model block rotations are `cubyz:no_rotation`, `cubyz:planar`, and `cubyz:torch`. Supported generated/data-driven semantic rotations are `cubyz:stairs`, `cubyz:fence`, `cubyz:branch`, `cubyz:carpet`, `cubyz:sign`, `cubyz:hanging`, `cubyz:texture_pile`, and selected `cubyz:direction` model blocks. Known cube-geometry rotations such as `cubyz:decayable`, `cubyz:log`, and `cubyz:ore` are recognized as cube shapes without warnings. Unsupported rotation metadata, missing model assets, malformed semantic model data (including a texture-pile with no resolvable model or an out-of-range state count), or unparseable OBJ models log a once-per-block warning and keep startup successful by using fallback shape behavior. Glass and translucent block rendering is out of scope; such blocks continue to use existing cube/fallback behavior.
- `EntityModelAssetService` scans `entityModels/**/*.zig.zon`, parses descriptors with the ZON parser, and keeps descriptors that are tagged `.playerModel` or are one of the supported avatar IDs (`cubyz:snale`, `cubyz:snail`, `cubyz:moffalo`, `cubyz:cubert`). Supported avatar IDs are allowed even without the tag because Cubyz's `/avatar` command can assign any entity model to a player.
- Manifests are resolved per entity model ID and cached; `/api/assets/player-marker/:entityModelId` returns the manifest for a requested avatar, and `/api/assets/player-marker` returns the default `cubyz:snale` manifest through the same resolver.
- The player marker manifest contains `available`, `entityModelId`, `modelUrl`, `textureUrl`, `height`, and `coordinateSystem`.
- Descriptors with missing `model` or `defaultTexture` references, invalid namespaced IDs, or unresolved `entityModels/models/*.glb` / `entityModels/textures/*.png` assets are skipped rather than returned as broken manifests.
- If a requested avatar has no loadable descriptor, the manifest route returns HTTP 200 with `available: false` so player data and fallback markers keep working.
- Entity model file serving uses opaque tokens generated from manifest-resolved files, registered only when a manifest referencing them is generated. The route does not accept arbitrary relative paths or namespace filesystem paths from the client.

### Player Avatar Resolution

- `loadEntityPalettes` reads `entity_component_palette.zig.zon` and `entity_model_palette.zig.zon` for the active save, caching per player-list load; missing palette files degrade to the default avatar.
- Player parsing decodes each player's `entity.components` URL-safe base64 stream using Cubyz varint and sized-slice encoding: repeated `(componentId varint, version varint, size-prefixed data)` triples. The `cubyz:model` component's payload is a single varint entity-model palette index resolved through `entity_model_palette.zig.zon`.
- `resolveAvatarModelId` returns `cubyz:snale` when component data is missing, malformed, the palettes are unavailable, the model component is absent, the palette index is out of range, or the resolved ID is not a supported avatar. The resolved ID is exposed as `entityModelId` on `/api/players`.
- `entityModelId` is part of the semantic player snapshot, so avatar-only save changes trigger the `players-updated` broadcast flow.

## Live Updates

- `SaveWatcher` watches `maps/`, `chunks/`, `players/`, and `world.zig.zon`.
- Emitted event names are `players-updated`, `world-updated`, `surface-index-changed`, and `terrain-updates-batch`.
- `terrain-updates-batch` carries both changed surface tiles and changed voxel regions.
- Player updates are coalesced behind a short timer and only broadcast when the semantic `/api/players` result actually changed.
- Terrain tile changes can trigger a throttled full voxel-cache clear; region changes clear per-region voxel entries.

## Runtime Configuration

- The server does not auto-load `.env` files.
- High-signal env vars: `PORT`, `HOST`, `SAVE_PATH`, `CUBYZ_PATH`, `VOXEL_MEMORY_CACHE_SIZE`, `VOXEL_WORKERS`, `VOXEL_PREGENERATE_ON_STARTUP`, `VOXEL_BROTLI_QUALITY`, `VOXEL_BROTLI_LGWIN`, `VOXEL_GZIP_LEVEL`, `VOXEL_PREFERRED_ENCODING`, `CORS_ALLOWED_ORIGINS`, `TERRAIN_UPDATE_BATCH_MS`, `PLAYER_UPDATE_BATCH_MS`, `PLAYER_ACTIVE_WINDOW_MS`, and `PLAYER_RETENTION_MS`.
- Voxel compression defaults to `VOXEL_BROTLI_QUALITY=6`, `VOXEL_BROTLI_LGWIN=11`, `VOXEL_GZIP_LEVEL=3`, and `VOXEL_PREFERRED_ENCODING=br`.

## Related Docs

- `docs/architecture-overview.md`: shared client/server contracts
- `docs/client-specification.md`: scene/runtime and invalidation behavior driven by this server
- `docs/deployment.md`: container and publish workflow
