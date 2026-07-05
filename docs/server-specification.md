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

- `/api/world`, `/api/world/surface-index`, `/api/world/chunk-index`: bootstrap world and index data
- `/api/players`: parsed player data with server-owned `isActive`
- `/api/terrain/:lod/:x/:y`: seam-safe terrain JSON built from the same-LOD 3x3 surface neighborhood; cached with ETag
- `/api/biomes/:lod/:x/:y`: grouped biome-label regions from `.surface` data
- `/api/voxels/:lod/:regionX/:regionY`: binary voxel mesh payloads with explicit `br`/`gzip` negotiation, ETags, and queue/timing headers
- `/api/assets/player-marker`: player marker asset manifest derived from layered `entityModels` descriptors
- `/api/assets/entity-models/files/:token`: opaque, manifest-addressable GLB/PNG entity model asset serving; tokens resolve only files registered by the player marker manifest
- `/api/health`: simple liveness endpoint

## Voxel Pipeline

- `VoxelMeshService` owns in-memory caching, in-flight dedupe, stale-result protection, and encoded response variants.
- `VoxelWorkerPool` runs the TypeScript worker through `src/server/workers/voxel-worker-dev.js` in dev and the built worker from `dist/server/workers/` in production.
- Global Express compression explicitly skips `/api/voxels`; that route negotiates and caches its own compressed variants.
- Voxel compression settings are configured once at startup and applied when each encoded variant is first generated. The default tuning is Brotli `quality=6`, `lgwin=11`, and gzip `level=3`.
- The voxel generator keeps the binary layout compact by reusing the existing per-quad AO byte for LOD `1/2` top faces and concave vertical wall corners instead of adding a separate wall-lighting payload.
- The voxel generator encodes vertex X/Y/Z as `u32` fixed-point coordinates in `1/4096` voxel-cell units relative to the response origin, allowing model vertices inside a block while preserving exact full-cube boundaries.
- Full-cube blocks still use exterior-air traversal plus greedy merged cube faces. Supported LOD `1` non-cube blocks emit explicit model quads with the existing palette color, no per-quad AO, and conservative non-occluding traversal so neighboring cube faces are not hidden by decorative geometry.
- Supported rotation semantic shapes are handled server-side. `cubyz:stairs` decodes the low 8 block-data bits as removed 2x2x2 sub-block octants and keeps data `0` on the full-cube fast path; `cubyz:fence` emits center posts plus saved horizontal connection arms for fences, walls, and bars; `cubyz:branch` emits center and six-direction branch arms from saved connection bits; `cubyz:carpet`, `cubyz:sign`, `cubyz:hanging`, and selected `cubyz:direction` blocks select finite model variants from block data.
- Higher LOD non-cube and semantic blocks use `lodReplacement` when it resolves to a palette entry; otherwise they fall back to the documented safe cube/air fallback shape instead of emitting tiny model geometry.
- Persistent voxel mesh cache keys include `VOXEL_GENERATOR_CACHE_VERSION` and the block shape table signature. The shape table signature includes a semantic support version plus shape-affecting block definition/model inputs, so semantic implementation or asset changes invalidate stale meshes.

## Assets And Overrides

- Asset lookup is layered: the server reads base assets from `CUBYZ_PATH/assets/*` and allows `SAVE_PATH/assets/*` to override matching namespace-relative files.
- That layered lookup is used for biome/block assets and entity model descriptor/model/texture resolution.
- `BlockShapeTable` scans `blocks/**/*.zig.zon`, applies inherited `_defaults.zig.zon` values by directory, resolves static `.model` references against `assets/*/models/*.obj`, and records palette-indexed cube, air, supported model, or supported semantic shapes.
- Supported static/model block rotations are `cubyz:no_rotation`, `cubyz:planar`, and `cubyz:torch`. Supported generated/data-driven semantic rotations are `cubyz:stairs`, `cubyz:fence`, `cubyz:branch`, `cubyz:carpet`, `cubyz:sign`, `cubyz:hanging`, and selected `cubyz:direction` model blocks. Known cube-geometry rotations such as `cubyz:decayable`, `cubyz:log`, and `cubyz:ore` are recognized as cube shapes without warnings. Unsupported rotation metadata, missing model assets, malformed semantic model data, or unparseable OBJ models log a once-per-block warning and keep startup successful by using fallback shape behavior.
- `EntityModelAssetService` scans `entityModels/**/*.zig.zon`, parses descriptors with the ZON parser, filters to loadable `.playerModel` descriptors, and selects `cubyz:snale` before falling back to the first stable entity model ID.
- The player marker manifest contains `available`, `entityModelId`, `modelUrl`, `textureUrl`, `height`, and `coordinateSystem`.
- Descriptors with missing `model` or `defaultTexture` references, invalid namespaced IDs, or unresolved `entityModels/models/*.glb` / `entityModels/textures/*.png` assets are skipped rather than returned as broken manifests.
- If no loadable player model descriptor exists, `/api/assets/player-marker` returns HTTP 200 with `available: false` so player data and fallback markers keep working.
- Entity model file serving uses opaque tokens generated from manifest-resolved files. The route does not accept arbitrary relative paths or namespace filesystem paths from the client.

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
