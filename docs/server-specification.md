# Server Specification

## Overview

The server is an Express application that reads Cubyz save files and exposes the world through HTTP and WebSocket APIs. It loads metadata and palettes, renders terrain tiles, generates voxel meshes, watches the save directory, and broadcasts update notifications.

This document describes server-owned behavior. Shared contracts such as coordinates, transport roles, LODs, and event names are defined in `docs/architecture-overview.md`.

## Top-Level Structure

```text
src/server/
  api/
  parsers/
  services/
  workers/
  index.ts
```

## Main Entry Point

`src/server/index.ts` is the composition root. It resolves and validates paths, discovers layered asset namespaces from the core Cubyz asset root plus the active save's local `assets/` overlay, loads world metadata and palettes, initializes the color map service, starts the voxel mesh service and worker pool, registers routers, optionally serves the built client bundle, starts HTTP and WebSocket servers, starts the save watcher, and can optionally launch a background voxel warmup pass.

During `npm run dev:server`, the main server runs from `src/server` via `tsx`, and the voxel worker pool uses a small source-side bootstrap that registers `tsx` before importing `src/server/workers/voxel-worker.ts`. In production builds and `npm start`, the worker pool still uses the compiled `dist/server/workers/voxel-worker.js` entrypoint. After startup the server logs the active voxel worker runtime mode as `source` or `dist` together with the worker count so the effective worker path is visible without inspecting processes.

It owns process lifecycle, route registration, WebSocket broadcasting, request context, CORS, and shutdown.

## Layer Responsibilities

### `api/`

HTTP route modules validate request parameters, call parser and service code, shape responses, set cache headers and status codes, and log failures.

Examples:

- `world.ts`: world metadata and indexes
- `players.ts`: parsed player data
- `terrain.ts`: raw terrain data for 3D terrain meshes
- `biomes.ts`: biome label data
- `voxels.ts`: binary voxel mesh payloads and metrics

### `parsers/`

File-format and binary decoding code that reads Cubyz data from disk without HTTP concerns.

Examples:

- `world-meta.ts`: `world.zig.zon`
- `surface.ts`: `.surface` files
- `region.ts`: `.region` files
- `player.ts`: player files
- `palette.ts` and `biome.ts`: palette and biome definitions
- `zon.ts` and `binary-reader.ts`: low-level helpers

### `services/`

Business logic and runtime infrastructure.

Examples:

- `color-map.ts`: builds block colors from Cubyz block definitions and biome data
- `terrain-data.ts`: builds 3D terrain mesh payloads from surface data
- `voxel-mesh-service.ts`: caches, dedupes, and orchestrates voxel mesh generation
- `voxel-worker-pool.ts`: manages the worker pool for voxel jobs
- `watcher.ts`: monitors the save directory and emits typed watch events
- `cache.ts`: LRU cache used by the voxel pipeline

### `workers/`

Server-side worker entry points and protocol definitions for voxel mesh generation.

- `voxel-worker.ts`: worker thread that parses regions and builds mesh payloads
- `voxel-worker-dev.js`: development-only bootstrap that loads the TypeScript worker source through `tsx`
- `voxel-worker-protocol.ts`: message and metrics types shared with the pool and service

## Logging

- `src/server/services/logger.ts` writes console output plus rotated file logs in `LOG_DIR`
- `server-error.log` and `server-combined.log` rotate at 20 MiB, keep 14 archives, and gzip-compress rotated files
- `LOG_REQUESTS=true` adds the same rotation/compression policy for `server-requests.log`
- WebSocket connect/disconnect events and watch-event broadcasts log at `debug`, so they stay hidden at the default `info` level

## Runtime Configuration

The root `.env.example` mirrors the server config list.

- `PORT`: HTTP bind port (`3001`)
- `HOST`: HTTP bind address (`0.0.0.0`)
- `VOXEL_MEMORY_CACHE_SIZE`: in-memory voxel mesh cache size (`1024` recommended for hosting)
- `VOXEL_FULL_CLEAR_THROTTLE_MS`: minimum gap in ms between broad voxel cache clears (`1000`)
- `TERRAIN_UPDATE_BATCH_MS`: save watcher batch window in ms for terrain updates (`15000`)
- `PLAYER_UPDATE_BATCH_MS`: quiet-period batch window in ms before the server rechecks players and considers broadcasting `players-updated` (`1000`)
- `PLAYER_ACTIVE_WINDOW_MS`: player freshness window in ms used to compute the `isActive` response field for client styling (`60000`)
- `PLAYER_RETENTION_MS`: maximum player age in ms before `/api/players` omits that player entirely (`300000`)
- `CORS_ALLOWED_ORIGINS`: comma-separated browser origin allowlist
- `SAVE_PATH`: Cubyz save directory; defaults to `/data/save` in the published container image and auto-detects the newest directory under `~/.cubyz/saves/` when unset
- `CUBYZ_PATH`: Cubyz project root or base asset source; defaults to `/data/cubyz` in the published container image and auto-detects the repository parent that contains `assets/cubyz` when unset
- `VOXEL_WORKERS`: voxel worker pool size; defaults to `floor(availableParallelism() / 2)` workers
- `VOXEL_CACHE_DIR`: persistent voxel mesh cache directory (`dist/server/cache/voxels`)
- `VOXEL_PREGENERATE_ON_STARTUP`: when `true`, the server starts a background voxel warmup pass that pre-generates persistent disk cache entries and warms the in-memory voxel mesh cache for discovered regions
- `LOG_DIR`: Winston file log directory for rotated logs (`logs`)
- `LOG_REQUESTS`: enables the rotated `server-requests.log` transport when set to `true`
- `LOG_LEVEL`: Winston log level (`info`); set `debug` to see WebSocket connect/disconnect and broadcast logs

The server rotates file logs at 20 MiB, keeps 14 archives per transport, and gzip-compresses rotated files.

At startup the server treats `CUBYZ_PATH/assets/*` as the base asset set and `SAVE_PATH/assets/*` as an optional sparse overlay. It discovers namespaces one directory below each root, such as `cubyz`, `materialz`, `MobilityBlocks`, or `fire`, and loads block definitions, block textures, and biome definitions from that union. For the same namespace-relative asset path, the save-local file wins over the core file.

## Request Flows

### World and Index Data

1. The client requests `/api/world`, `/api/world/surface-index`, or `/api/world/chunk-index`.
2. The route reads the relevant save metadata or directory structure.
3. The server returns compact JSON used to bootstrap the client scene and populate the world summary.

### Player Metadata and Textures

1. The client requests `/api/players` for current player positions, rotation, and health.
2. The client requests `/api/assets/entities/models/:name` and `/api/assets/entities/textures/:name` for entity assets.
3. Those entity routes resolve `cubyz` assets through the same layered asset lookup, so a save-local `assets/cubyz/entities/...` file overrides the base Cubyz copy when present.
4. The viewer combines the payloads client-side to render clickable player representations.
5. `/api/players` returns players whose save files still fall within `PLAYER_RETENTION_MS`, and each entry includes `isActive` computed from the shorter `PLAYER_ACTIVE_WINDOW_MS` so the client can gray out stale markers without recomputing freshness locally.

### Terrain Mesh Data

1. The client requests `/api/terrain/:lod/:x/:y` for 3D terrain payloads.
2. `terrain.ts` validates the tile params, resolves the backing `.surface` file, sets a 1-hour browser cache, and revalidates with an ETag before parsing the surface when the browser asks.
3. `parseSurfaceFile` decodes the height and biome arrays for the requested tile and any same-LOD neighbors needed by the terrain seam gutter.
4. `terrain.ts` computes the terrain ETag from the same-LOD 3x3 neighborhood because the seam-safe terrain payload depends on adjacent surface tiles as well as the center tile.
5. `terrain-data.ts` converts that neighborhood into a seam-safe JSON payload containing a visible vertex grid plus a 1-vertex gutter of neighbor-aware height and color samples for the client mesh builder.
6. The client schedules those payloads through a bounded fetch queue and a per-frame mesh-build queue so zooming does not try to build every refined terrain tile immediately.

### Biome Label Data

1. The client requests `/api/biomes/:lod/:x/:y`.
2. `biomes.ts` validates the tile params, resolves the backing `.surface` file, sets a 1-hour browser cache, and revalidates with an ETag before parsing the surface when the browser asks.
3. `parseSurfaceFile` decodes the biome array, and the route groups biome cells into aggregate label regions.

### Voxel Mesh Generation

1. The client requests `/api/voxels/:lod/:regionX/:regionY`.
2. `voxels.ts` validates region alignment and delegates to `VoxelMeshService`.
3. `VoxelMeshService` checks its in-memory cache first.
4. On cache miss, it submits a job to `VoxelWorkerPool`.
5. A worker parses one or more `.region` files, generates a greedy mesh, computes packed top-face AO with same-LOD neighbor sampling across region edges for `L1` and `L2`, and returns an indexless binary payload plus metrics.
6. The binary mesh payload preserves direct world `X/Y/Z` coordinates and carries separate per-quad color, packed face AO, winding, and vertex-position sections so the client can defer final top-face AO application until after LOD visibility is known.
7. The service drops stale results using epoch-based invalidation, caches the raw payload, and lazily caches `br` and `gzip` encoded variants keyed by `Accept-Encoding`.
8. The route negotiates compressed voxel transport, computes the current ETag from source-file metadata before resolving the mesh body, and exposes timing and queue metrics through response headers.

When `VOXEL_PREGENERATE_ON_STARTUP=true`, the server also walks the chunk index after it starts listening and requests each region once through `VoxelMeshService`. That background pass is best-effort, bounded for concurrency, populates the persistent `VOXEL_CACHE_DIR` cache for new meshes, and keeps recently processed raw payloads hot in the in-memory voxel cache.

### Voxel Benchmarking

- `GET /api/voxels/metrics` returns aggregate voxel service metrics
- `GET /api/voxels/metrics?lod=<lod>&regionX=<x>&regionY=<y>` benchmarks one voxel region and returns raw, `gzip`, and `br` payload sizes plus variant-generation time
- add `fresh=1` to force new `gzip` and `br` compression work instead of reusing cached variants

## Real-Time Update Flow

### Save Watching

`SaveWatcher` monitors:

- `maps/`
- `chunks/`
- `players/`
- `world.zig.zon`

It emits:

- `players-updated`
- `world-updated`
- `surface-index-changed`
- `terrain-updates-batch`

`terrain-updates-batch` groups tile and region changes over a configurable window so the client is not flooded with per-file events.

`players-updated` now acts as a delayed invalidation signal. The watcher still notices `players/` file churn immediately, but the server waits for `PLAYER_UPDATE_BATCH_MS`, reloads players once, compares a semantic snapshot that excludes timestamp-only noise, and only broadcasts when player-visible state changed.

`findSavePath()` auto-detects the newest save directory under `~/.cubyz/saves/` by modification time when `SAVE_PATH` is not set.

### Broadcast and Invalidation

1. Voxel mesh cache entries are invalidated for changed voxel regions.
2. Broad terrain changes can trigger a throttled full voxel cache clear.
3. Player update broadcasts are suppressed when the reloaded player snapshot differs only by `lastSeen` or other timestamp-derived noise.
4. Terrain tile change notifications remain tile-scoped on the wire, while the client expands them to the same-LOD 3x3 neighborhood because each seam-safe terrain response depends on adjacent surface files.
5. The event is broadcast to all connected WebSocket clients.

## Request Context and Errors

- every request gets a request ID, echoed back as `X-Request-Id`
- validation helpers in `api/validation.ts` throw typed `400` errors at the boundary
- `api/error-handler.ts` is the final Express error middleware and produces structured JSON errors
- `api/http.ts` centralizes ETag matching and async file-stat helpers

## CORS and Security

- the server does not send wildcard CORS by default
- cross-origin access must be enabled via `CORS_ALLOWED_ORIGINS`
- basic hardening headers include `X-Content-Type-Options: nosniff` and `Cross-Origin-Resource-Policy: same-origin`

## Shutdown

- `SIGINT` and `SIGTERM` both trigger graceful shutdown
- shutdown stops the watcher, closes WebSocket clients, closes the HTTP server, and destroys the voxel mesh service

## Caching Strategy

### Voxel Meshes

- cached in memory by `lod/regionX/regionY`
- deduplicated across concurrent requests using an in-flight map
- protected against stale writes with global and per-key epochs
- exposed with encoding-specific ETags so clients can revalidate cheaply
- cache raw payloads plus lazily generated `gzip` and `br` variants for repeated responses
- can persist generated mesh payloads on disk via `VOXEL_CACHE_DIR` for faster warm restarts and container reuse
- can optionally pre-generate both persistent and in-memory voxel caches on startup via `VOXEL_PREGENERATE_ON_STARTUP`

## WebSocket Role

The WebSocket server at `/ws` does not stream world data directly. It streams change notifications.

HTTP provides authoritative world payloads. WebSocket provides low-latency invalidation signals.

## Design Principles

- keep parsing separate from HTTP transport
- use workers for CPU-heavy voxel generation
- prefer targeted invalidation over full rebuilds
- batch filesystem churn before broadcasting it to clients
- expose enough metrics to debug voxel throughput and latency

## Related Documentation

- `docs/architecture-overview.md` for shared system contracts
- `docs/client-specification.md` for the client-side rendering and invalidation behavior driven by this server
- `docs/deployment.md` for container runtime setup, publishing, and operations guidance
