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
- the server resolves Cubyz block shape metadata from layered block definitions, OBJ model assets, and supported rotation semantics, keeps full-cube terrain on the greedy meshing path, and emits explicit quads for supported LOD `1` non-cube block models or generated semantic shapes; this includes `cubyz:texture_pile` blocks (such as leaf piles) rendered as their referenced plane model instead of full cubes, and `cubyz:sign` floor/ceiling variants rendered with eight-way 45-degree orientation
- changing how a supported Cubyz shape or rotation semantic is interpreted invalidates persisted voxel meshes through the shape-metadata signature and the voxel generator cache version, so stale geometry is regenerated rather than reused
- voxel vertex positions are encoded as unsigned fixed-point values relative to the response origin, using `1/4096` voxel-cell units for X, Y, and Z; the client decodes them as `origin + fixed * voxelSize / 4096`
- voxel mesh payloads include one packed AO byte per quad; at LOD `1` and `2` that AO applies to top faces and to a thin top band on vertical walls so tall cliffs do not get full-height AO gradients, while the client still performs the final visibility-dependent top-edge seam softening after LOD coverage is resolved
- voxel mesh payloads include a compact per-quad block palette index section; the client preserves this as per-triangle metadata through worker quadrant splitting so voxel raycast hover can display the saved block ID for the visible face
- voxel mesh payloads include compact per-quad render-kind data so the client can build opaque and transparent meshes separately while preserving colors, normals, AO, winding, positions, and palette identity
- the client uses loaded voxel mesh bounds to keep nearby visible geometry detailed, while unloaded regions still rely on cheap region-aligned distance heuristics from the chunk index
- the client may apply final visibility-dependent shading after LOD coverage is resolved, so the payload structure and face-data semantics must stay aligned across both sides

### Live Update Contract

- save watching batches filesystem churn into grouped update events
- the main event names are `players-updated`, `world-updated`, `surface-index-changed`, and `terrain-updates-batch`
- `players-updated` is a server-side invalidation hint only: the server waits for a short quiet window, reloads `/api/players`, compares a semantic player snapshot, and only broadcasts when the player view state actually changed
- `/api/players` includes `isActive` as the server-owned player activity flag for client styling, while stale player removal uses a longer retention window
- `/api/players` also includes `entityModelId`, the resolved supported avatar model ID for each player; it is part of the semantic snapshot, so avatar-only save changes trigger `players-updated`
- if event names, payload shapes, or update semantics change, update the server, client, and docs together

### Player Avatar Contract

- each player's avatar is decoded server-side from the saved `cubyz:model` entity component in `players/*.zon` (`entity.components`, URL-safe base64) and resolved through `entity_component_palette.zig.zon` and `entity_model_palette.zig.zon`
- resolution is conservative: missing, malformed, out-of-range, or unsupported component data falls back to the default avatar `cubyz:snale`
- the viewer renders the supported avatars `cubyz:snale`, `cubyz:snail`, `cubyz:moffalo`, and `cubyz:cubert`

### Player Marker Asset Contract

- player marker models are discovered server-side from layered Cubyz `entityModels/**/*.zig.zon` descriptors
- layered asset precedence is core Cubyz assets first and save assets second, so matching save asset files override core files for descriptors, GLB models, and PNG textures
- `/api/assets/player-marker/:entityModelId` returns the manifest for a specific supported avatar with `available`, `entityModelId`, `modelUrl`, `textureUrl`, `height`, and `coordinateSystem`; `/api/assets/player-marker` remains as the default `cubyz:snale` manifest
- a resolvable descriptor must be tagged `.playerModel` or be one of the supported avatar IDs, and must have resolvable `model` and `defaultTexture` references
- when a requested avatar has no loadable descriptor, the manifest returns `available: false` and the client keeps rendering the default avatar or fallback dot markers
- model and texture URLs from the manifest are opaque server-generated asset URLs; the browser must not construct filesystem paths directly

## Documentation Map

- `docs/architecture-overview.md`: system overview and shared client/server contracts
- `docs/client-specification.md`: client architecture, rendering flow, state ownership, and live-update handling
- `docs/server-specification.md`: server architecture, route flows, watcher flow, caching, workers, and runtime configuration
- `docs/deployment.md`: image publishing, container runtime setup, mounts, and deployment troubleshooting
