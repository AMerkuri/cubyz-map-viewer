# Cubyz Map Viewer Architecture Overview

## Purpose

This document describes the system-level architecture and the shared contracts between the browser client and the Node.js server.

Keep cross-cutting behavior here. Client-only rendering details belong in `docs/client-specification.md`. Server-only API, watcher, cache, worker, and runtime configuration details belong in `docs/server-specification.md`. Deployment and container operations belong in `docs/deployment.md`.

## System Overview

Cubyz Map Viewer is an interactive voxel viewer for Cubyz worlds, with an optional terrain underlay derived from surface data.

The system has three main runtime pieces:

- a React and Three.js browser client
- a Node.js server that reads Cubyz save data and exposes HTTP and WebSocket endpoints
- a Cubyz save directory and Cubyz assets that provide world, biome, block, and entity data

At a high level:

1. The client fetches authoritative world data over HTTP.
2. The server reads and transforms Cubyz save files into terrain, biome, player, and voxel payloads.
3. The client renders a voxel scene from those payloads and can show terrain as an optional underlay.
4. The server watches the save directory and broadcasts change notifications over WebSocket.
5. The client reacts to those notifications by invalidating and reloading affected data.

## Shared Contracts

### Coordinate System

- world coordinates use `X` and `Y` horizontally and `Z` vertically
- voxel payloads preserve direct world coordinates, so the client does not mirror an axis
- treat this coordinate convention as stable unless both sides and the docs are updated together

### Camera URL Contract

- camera URLs use world-coordinate `x`, `y`, `z` plus `zoom`, `theta`, and `phi` query parameters
- viewer-generated copied-location URLs include `focus=exact`, which tells the client to restore the supplied camera target exactly
- URLs without `focus=exact` are accepted as map-compatible links; the client may retarget their supplied altitude to the best available visible surface at the supplied `x,y` while preserving `zoom`, `theta`, and `phi`

### Source Data Layout

- surface tiles come from `maps/{lod}/{worldX}/{worldY}.surface`
- region voxel data comes from `chunks/{lod}/{worldX}/{worldY}/{worldZ}.region`
- supported LODs are `1, 2, 4, 8, 16, 32`
- surface tile size is `MAP_SIZE = 256`

### Transport Roles

- HTTP provides authoritative world payloads
- WebSocket provides low-latency invalidation and change notifications only
- the client refetches HTTP resources after relevant WebSocket events instead of treating socket payloads as the source of truth

### Terrain Contract

- terrain payloads are seam-safe across same-LOD tile borders
- each terrain response includes the visible vertex grid plus a 1-vertex gutter derived from the same-LOD tile neighborhood
- the client uses that gutter data when rebuilding terrain so same-LOD tile borders stay visually consistent
- when terrain tile topology changes, the client refreshes affected visible terrain instead of assuming the old mesh still matches neighboring data

### Voxel Contract

- voxel payloads are requested by LOD and region coordinates
- `/api/world/chunk-index` returns one entry per available voxel region column with `lod`, `regionX`, and `regionY`
- `/api/world/block-palette` returns the save block palette string table so the client can resolve voxel face palette indices to saved block IDs without per-hover requests
- the server generates payloads from `.region` files and keeps coordinate space in world units
- the server resolves palette-indexed block visual metadata from layered Cubyz block definitions, including inherited `_defaults.zig.zon` values, and distinguishes air, opaque renderable, and transparent renderable blocks before voxel meshing
- the server resolves Cubyz block shape metadata from layered block definitions, OBJ model assets, and supported rotation semantics, preserves supported OBJ vertices as authored block-local coordinates even when model bounds exceed `0..1`, keeps full-cube terrain on the greedy meshing path, and emits explicit quads for supported LOD `1` non-cube block models or generated semantic shapes; this includes `cubyz:texture_pile` blocks (such as leaf piles) rendered as their referenced plane model instead of full cubes, and `cubyz:sign` floor/ceiling variants rendered with eight-way 45-degree orientation
- changing how a supported Cubyz shape, OBJ coordinate interpretation, or rotation semantic is interpreted invalidates persisted voxel meshes through the shape-metadata signature and the voxel generator cache version, so stale geometry is regenerated rather than reused
- voxel mesh payloads use a cache-versioned mixed record layout: ordinary greedy cube quads are encoded as parametric rectangles (`face`, `plane`, `u`, `v`, `du`, `dv`) relative to the response origin, while model/semantic quads use four authored fixed-point vertices in `1/4096` voxel-cell units; the client decodes both forms to the same world coordinate space
- voxel mesh payloads include one packed AO byte per quad; at LOD `1` and `2` that AO applies to top faces and to a thin top band on vertical walls so tall cliffs do not get full-height AO gradients, while the client still performs the final visibility-dependent top-edge seam softening after LOD coverage is resolved
- voxel mesh payloads include a compact per-quad block palette index section; the client preserves this as per-triangle metadata through worker quadrant splitting so voxel raycast hover can display the saved block ID for the visible face
- voxel mesh payloads include compact per-quad render-kind data plus header-level greedy/model record counts so the client can build opaque and transparent meshes separately while preserving colors, normals, AO, winding, positions, and palette identity, and so diagnostics can distinguish greedy cube quads from model/semantic quads without per-quad source/position-kind side arrays
- voxel mesh payloads include a versioned compact emitter-record section after greedy/model geometry records; an LOD `1` own emitter is created only after the source contributes an accepted cube face or model/semantic quad, so hidden, depth-suppressed, or model-budget-rejected `.emittedLight` metadata cannot create a record. Records retain signed response-relative coordinates, RGB bytes, and open-face masks without changing the binary layout
- the server builds LOD `1` halo records with generation-local external-region and unified target/external traversability-promise caches. External candidates must resolve to represented source geometry, have an open face, fall within the visible vertical envelope, and reach generated opaque receiving geometry within radius before the existing deterministic 8,192-record selection boundary ranks them; edge and corner reservations therefore preserve relevant seam sources without admitting unrelated full-column lights
- coarser payload emitters come from a persisted hierarchy of bounded, represented LOD `1` source summaries aligned to LOD `1, 2, 4, 8, 16, 32` region footprints. Coarse generation retains qualified source energy, including small source models replaced by air, only when the representative radius reaches generated opaque geometry at the requested LOD; neighbor-owned records remain payload-local halos for equivalent boundary baking without duplicate runtime accents
- the VXM6 header optionally identifies one four-byte metadata entry per emitter (`u16` Q8.8 source-equivalent power, `u8` world radius, zero reserved byte); absent metadata means power `1` and radius `12`, which keeps ordinary LOD `1` records compact and behaviorally unchanged; metadata count/offset/bounds are validated independently
- the browser worker decodes selected payload emitters and bakes their bounded, reachability-filtered contribution into mesh-local emissive attributes; halo records participate only in that payload-local bake, while loaded tiles retain own-emitter metadata for runtime accents. On rendered frames that pass the active/idle cap, a loaded-voxel revision gates region reconciliation and the main thread uses bounded deterministic nearest selection to assign a fixed global glow pool and bounded point-light pool. The shared shader uniform drives the baked day-floor-to-night emissive result independently; glow sprites and dynamic Lambert point lights are optional accents and are hidden transition-safely when inactive
- seam-affecting server changes cross this payload/cache/worker boundary and therefore require matrix evidence for X/Y edges, corners, vertical extremes, dense own and both-side pressure, missing/special neighbors, and coarse summary halos: decoded retained records must be deterministic, and the seam validator imports the production voxel worker to compare normalized emissive attributes at matching world-position-and-normal vertices from adjacent LOD1 and LOD2 payloads within one encoded attribute step
- LOD `1` model/semantic geometry has a high per-region safety ceiling that only bounds pathological payloads; ordinary dense decorative regions (spawn areas, sign-heavy plots, forests) render their full model geometry, and the dropped model-quad count is reported in service metrics only when the ceiling is exceeded
- debug-only voxel-lighting diagnostics: the client may request `/api/voxels/...?halo=0` to receive a payload generated without neighboring-region halo emitter records; such diagnostic payloads are cached and ETagged separately from normal payloads, and voxel responses expose cache/timing, own/halo/coarse representative counts, metadata bytes, encoded power/radius ranges, and summary cache/build/leaf/source/retention metrics; the client additionally reports emissive grid-build, bake, and evaluated/culled quad metrics; default behavior (no query parameter) is unchanged
- the client uses loaded voxel mesh bounds to keep nearby visible geometry detailed, while unloaded regions still rely on cheap region-aligned distance heuristics from the chunk index
- the client may apply final visibility-dependent shading after LOD coverage is resolved, so the payload structure and face-data semantics must stay aligned across both sides

### Sign Text Contract

- sign text is served separately from the binary voxel mesh; the mesh payload stays geometry-only
- `/api/signs/{lod}/{regionX}/{regionY}` returns a JSON array of per-region sign records, keyed by LOD and region coordinates consistent with the voxel/region addressing scheme, and routed through `VoxelMeshService`
- each sign record has `position` (world block minimum corner, `X`/`Y` horizontal and `Z` vertical), `data` (orientation `0-19`), `text` (raw UTF-8 Cubyz formatted source text with formatting controls such as color codes, emphasis toggles, escapes, resets, and `\n` preserved verbatim, exactly as decoded from the block entity), and `corners` (four world-space corners of the sign's text plane)
- the server recovers sign text by decoding the block-entity stream that trails entity-carrying `.region` chunk blobs and joins it with the block palette and sign shape classification; empty-text signs and non-sign block entities produce no record; the server does not strip, normalize, or pre-render Cubyz text formatting controls
- the server sends the text-plane corners so the client does not re-derive orientation; the corners are computed from the same sign geometry that positions the board
- signs with no records return an empty JSON array; regions with no signs and coarser LODs (`> 1`) return an empty array
- the client renders sign text only at LOD `1`, decoding the formatted source text with Cubyz `TextBuffer.Parser` semantics before layout so color codes, bold, italic, underline, strikethrough, escapes, and reset do not render as visible glyphs; each sign is rendered as a single texture-mapped quad placed on the four corners, occluded by terrain, and invalidated on `world-updated` and `terrain-updates-batch` events for affected regions

### Live Update Contract

- save watching batches filesystem churn into grouped update events
- the main event names are `players-updated`, `world-updated`, `surface-index-changed`, and `terrain-updates-batch`
- `players-updated` is a server-side invalidation hint only: the server waits for a short quiet window, reloads `/api/players`, compares a semantic player snapshot, and only broadcasts when the player view state actually changed
- `/api/players` includes `isActive` as the server-owned player activity flag for client styling, while stale player removal uses a longer retention window
- `/api/players` also includes `entityModelId`, the resolved player avatar model ID for each player; it is part of the semantic snapshot, so avatar-only save changes trigger `players-updated`
- if event names, payload shapes, or update semantics change, update the server, client, and docs together
- an LOD `1` region update invalidates its exposure-dependent neighboring leaves, aligned summary ancestors through LOD `32`, dependent coarse voxel cache identities, and loaded or warm client tiles for those ancestor footprints before they refresh through the normal voxel route

### Player Avatar Contract

- each player's avatar is decoded server-side from the saved `cubyz:model` entity component in `players/*.zon` (`entity.components`, URL-safe base64) and resolved through `entity_component_palette.zig.zon` and `entity_model_palette.zig.zon`
- resolution is conservative: missing, malformed, or out-of-range component data, missing palettes, or out-of-range palette indices fall back to the default avatar `cubyz:snale`; any other palette-resolved model ID is returned verbatim so the manifest service and client can decide whether it renders
- the viewer renders any avatar whose `entityModels` descriptor is tagged `.playerModel` (or backstopped by the vanilla `SUPPORTED_PLAYER_MODEL_IDS` set: `cubyz:snale`, `cubyz:snail`, `cubyz:moffalo`, `cubyz:cubert`) and has resolvable model/texture assets; custom namespaces such as `skinz:` are eligible via the tag

### Player Marker Asset Contract

- player marker models are discovered server-side from layered Cubyz `entityModels/**/*.zig.zon` descriptors
- layered asset precedence is core Cubyz assets first and save assets second, so matching save asset files override core files for descriptors, GLB models, and PNG textures
- `/api/assets/player-marker/:entityModelId` returns the manifest for a specific requested avatar model ID (any palette-resolved string) with `available`, `entityModelId`, `modelUrl`, `textureUrl`, `height`, and `coordinateSystem`; `/api/assets/player-marker` remains as the default `cubyz:snale` manifest
- a resolvable descriptor must be tagged `.playerModel` or be backstopped by the vanilla `SUPPORTED_PLAYER_MODEL_IDS` set, and must have resolvable `model` and `defaultTexture` references
- when a requested avatar has no loadable descriptor, the manifest returns `available: false` and the client keeps rendering the default avatar or fallback dot markers
- model and texture URLs from the manifest are opaque server-generated asset URLs; the browser must not construct filesystem paths directly

## Documentation Map

- `docs/architecture-overview.md`: system overview and shared client/server contracts
- `docs/client-specification.md`: client architecture, rendering flow, state ownership, and live-update handling
- `docs/server-specification.md`: server architecture, route flows, watcher flow, caching, workers, and runtime configuration
- `docs/deployment.md`: image publishing, container runtime setup, mounts, and deployment troubleshooting
