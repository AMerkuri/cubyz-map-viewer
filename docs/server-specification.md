# Server Specification

## Overview

The server is an Express application that reads Cubyz save files and exposes the world through HTTP and WebSocket APIs. It loads metadata and palettes, renders terrain tiles, generates voxel meshes, watches the save directory, and broadcasts update notifications.

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

`src/server/index.ts` is the composition root. It resolves and validates paths, loads world metadata and palettes, initializes the color map service, starts the voxel mesh service and worker pool, registers routers, optionally serves the built client bundle, starts HTTP and WebSocket servers, and then starts the save watcher.

It owns process lifecycle, route registration, WebSocket broadcasting, request context, CORS, and shutdown behavior.

## Layer Responsibilities

### `api/`

HTTP route modules validate request parameters, call parser and service code, shape responses, set cache headers and status codes, and log request failures.

Examples:

- `tiles.ts`: rendered PNG terrain tiles
- `world.ts`: world metadata and indexes
- `players.ts`: parsed player data
- `terrain.ts`: raw terrain data for 3D terrain meshes
- `biomes.ts`: biome label data
- `voxels.ts`: binary voxel mesh payloads and metrics

### `parsers/`

File-format and binary decoding code that knows how to read Cubyz data from disk but not HTTP.

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
- `tile-renderer.ts`: converts parsed surface data into PNG tiles
- `voxel-mesh-service.ts`: caches, dedupes, and orchestrates voxel mesh generation
- `voxel-worker-pool.ts`: manages the worker pool for voxel jobs
- `watcher.ts`: monitors the save directory and emits typed watch events
- `cache.ts`: LRU cache used by terrain and voxel pipelines

### Logging

- `src/server/services/logger.ts` writes console output plus rotated file logs in `LOG_DIR`
- `server-error.log` and `server-combined.log` rotate at 20 MiB, keep 14 archives, and gzip-compress rotated files
- `LOG_REQUESTS=true` adds the same rotation/compression policy for `server-requests.log`

### `workers/`

Server-side worker entry points and protocol definitions used for voxel mesh generation.

- `voxel-worker.ts`: worker thread that parses regions and builds mesh payloads
- `voxel-worker-protocol.ts`: message and metrics types shared with the pool and service

## Request Flows

### World and Index Data

1. The client requests `/api/world`, `/api/world/surface-index`, or `/api/world/chunk-index`.
2. The route reads the relevant save metadata or directory structure.
3. The server returns compact JSON used to bootstrap the client scene and populate the world summary.

### Player Metadata and Textures

1. The client requests `/api/players` for current player positions, rotation, and health.
2. The client requests `/api/assets/entities/models/:name` and `/api/assets/entities/textures/:name` for entity assets.
3. The viewer combines the payloads client-side to render clickable player representations.

### Terrain Tile Rendering

1. The client requests `/api/tiles/:lod/:x/:y.png`.
2. `tiles.ts` maps tile coordinates to the backing `.surface` file.
3. If the file exists, `parseSurfaceFile` decodes it.
4. `tile-renderer.ts` renders a PNG using `ColorMapService`.
5. The result is cached by tile coordinates and source mtime.
6. If the surface file does not exist, the server returns an empty tile.

### Terrain Mesh Data

1. The client requests `/api/terrain/:lod/:x/:y` for 3D terrain payloads.
2. `terrain.ts` validates the tile params, resolves the backing `.surface` file, and revalidates with an ETag.
3. `parseSurfaceFile` decodes the height and biome arrays.
4. `terrain-data.ts` down-samples the surface into JSON height and color arrays for the client mesh builder.
5. The client now schedules those payloads through a bounded fetch queue and a per-frame mesh-build queue so zooming does not try to build every refined terrain tile immediately.

### Voxel Mesh Generation

1. The client requests `/api/voxels/:lod/:regionX/:regionY`.
2. `voxels.ts` validates region alignment and delegates to `VoxelMeshService`.
3. `VoxelMeshService` checks its in-memory cache first.
4. On cache miss, it submits a job to `VoxelWorkerPool`.
5. A worker parses one or more `.region` files, generates a greedy mesh, and returns an indexless binary payload plus metrics.
6. The binary mesh payload preserves direct world `X/Y/Z` coordinates so the client does not mirror an axis during decode.
7. The service drops stale results using epoch-based invalidation, caches the raw payload, and lazily caches `br` and `gzip` encoded variants keyed by `Accept-Encoding`.
8. The route negotiates compressed voxel transport and exposes timing and queue metrics through response headers.

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

### Broadcast and Invalidation

1. Terrain tile cache entries are invalidated for changed surface tiles.
2. Voxel mesh cache entries are invalidated for changed voxel regions.
3. Broad terrain changes can trigger a throttled full voxel cache clear.
4. The event is broadcast to all connected WebSocket clients.

## Request Context and Errors

- every request gets a request ID, echoed back as `X-Request-Id`
- validation helpers in `api/validation.ts` throw typed `400` errors at the boundary
- `api/error-handler.ts` is the final Express error middleware and produces structured JSON errors
- `api/http.ts` centralizes `ETag` matching and async file-stat helpers

## CORS and Security

- the server does not send wildcard CORS by default
- cross-origin access must be enabled via `CORS_ALLOWED_ORIGINS`
- basic hardening headers include `X-Content-Type-Options: nosniff` and `Cross-Origin-Resource-Policy: same-origin`

## Shutdown

- `SIGINT` and `SIGTERM` both trigger graceful shutdown
- shutdown stops the watcher, closes WebSocket clients, closes the HTTP server, and destroys the voxel mesh service

## Caching Strategy

### Terrain Tiles

- cached in memory via `LRUCache`
- invalidated by source file modification time
- unexplored areas are not permanently cached as rendered data

### Voxel Meshes

- cached in memory by `lod/regionX/regionY`
- deduplicated across concurrent requests using an in-flight map
- protected against stale writes with global and per-key epochs
- exposed with encoding-specific ETags so clients can revalidate cheaply
- cache raw payloads plus lazily generated `gzip` and `br` variants for repeated responses
- can persist generated mesh payloads on disk via `VOXEL_CACHE_DIR` for faster warm restarts and container reuse

## WebSocket Role

The WebSocket server at `/ws` does not stream world data directly. It streams change notifications.

HTTP provides authoritative world payloads. WebSocket provides low-latency invalidation signals.

## Design Principles

- keep parsing separate from HTTP transport
- use workers for CPU-heavy voxel generation
- prefer targeted invalidation over full rebuilds
- batch filesystem churn before broadcasting it to clients
- expose enough metrics to debug voxel throughput and latency
