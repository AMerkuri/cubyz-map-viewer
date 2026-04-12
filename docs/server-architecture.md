# Server Architecture

## Purpose

The server is an Express application that reads Cubyz save files and exposes the world to the client through HTTP and WebSocket APIs.

It is responsible for:

- loading world metadata and palettes
- parsing terrain and voxel source files
- rendering terrain tiles
- generating voxel mesh payloads
- watching the save directory for live updates
- broadcasting those updates to connected clients

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

### `src/server/index.ts`

`index.ts` is the composition root. It performs startup in this order:

1. resolve the save path and Cubyz asset path
2. validate the save directory
3. load world metadata
4. load block and biome palettes
5. load biome definitions from Cubyz assets
6. initialize the color map service
7. start the voxel mesh service and worker pool
8. create caches and routers
9. optionally serve the built client bundle from `dist/client` when present
10. start the HTTP server and WebSocket server
11. start the save watcher

This file owns process lifecycle, route registration, WebSocket broadcasting, request context, CORS, and shutdown behavior.

## Layer Responsibilities

### `api/`

HTTP route modules. They are responsible for:

- validating request parameters
- calling parser and service code
- shaping HTTP responses
- setting cache headers and status codes
- logging request-level failures

Route modules share small helpers for request validation, HTTP errors, request IDs, and cache/etag behavior.

Examples:

- `tiles.ts`: serves rendered PNG terrain tiles
- `world.ts`: serves world metadata and indexes
- `players.ts`: serves parsed player data
- `terrain.ts`: serves raw terrain data for 3D terrain meshes
- `biomes.ts`: serves biome label data
- `voxels.ts`: serves binary voxel mesh payloads and metrics

### `parsers/`

File-format and binary decoding code. These modules know how to read Cubyz data from disk but do not know anything about HTTP.

Examples:

- `world-meta.ts`: parses `world.zig.zon`
- `surface.ts`: parses `.surface` files
- `region.ts`: parses `.region` files
- `player.ts`: parses player files
- `palette.ts` and `biome.ts`: parse palette and biome definitions
- `zon.ts` and `binary-reader.ts`: lower-level parsing helpers

### `services/`

Business logic and runtime infrastructure.

Examples:

- `color-map.ts`: builds block colors from textures and biome data; missing block textures fall back to a light-purple placeholder
- `tile-renderer.ts`: converts parsed surface data into PNG tiles
- `terrain-data.ts`: prepares terrain payloads for the client
- `voxel-mesh-service.ts`: cache, dedupe, and orchestration for voxel mesh generation
- `voxel-worker-pool.ts`: manages the worker pool for voxel jobs
- `watcher.ts`: monitors the save directory and emits typed watch events
- `cache.ts`: simple LRU cache used by terrain and voxel pipelines

### `workers/`

Server-side worker entrypoints and protocol definitions used for voxel mesh generation.

- `voxel-worker.ts`: worker thread that parses regions and builds mesh payloads
- `voxel-worker-protocol.ts`: message and metrics types shared with the pool/service

## Request Flows

### World and index data

1. The client requests `/api/world`, `/api/world/surface-index`, or `/api/world/chunk-index`.
2. The route reads the relevant save metadata or directory structure.
3. The server returns compact JSON used to bootstrap the client scene and populate the world summary in the info panel.

### Player metadata and textures

1. The client requests `/api/players` for current player positions, rotation, and health.
2. The client requests `/api/assets/entities/models/:name` and `/api/assets/entities/textures/:name` for entity assets used by in-scene markers.
3. The viewer combines the player payload with those model and texture assets client-side to render clickable player representations.

## Request Context And Errors

- every request gets a request ID, echoed back as `X-Request-Id`
- validation helpers in `api/validation.ts` throw typed `400` errors at the boundary
- `api/error-handler.ts` is the final Express error middleware and produces structured JSON errors
- `api/http.ts` centralizes `ETag` matching and async file-stat helpers

## CORS And Security

- the server does not send wildcard CORS by default
- cross-origin access must be enabled via `CORS_ALLOWED_ORIGINS`
- basic hardening headers include `X-Content-Type-Options: nosniff` and `Cross-Origin-Resource-Policy: same-origin`

## Shutdown

- `SIGINT` and `SIGTERM` both trigger graceful shutdown
- shutdown stops the watcher, closes WebSocket clients, closes the HTTP server, and destroys the voxel mesh service

## Surface Parsing

- `.surface` parsing now uses async decompression on the request path
- voxel `.region` parsing remains in worker threads

### Terrain tile rendering

1. The client requests `/api/tiles/:lod/:x/:y.png`.
2. `tiles.ts` maps tile coordinates to the backing `.surface` file.
3. If the file exists, `parseSurfaceFile` decodes it.
4. `tile-renderer.ts` renders a PNG using `ColorMapService`.
5. The result is cached in an LRU cache keyed by tile coordinates and source mtime.
6. If the surface file does not exist, the server returns an empty tile.

### Voxel mesh generation

1. The client requests `/api/voxels/:lod/:regionX/:regionY`.
2. `voxels.ts` validates region alignment and delegates to `VoxelMeshService`.
3. `VoxelMeshService` first checks its in-memory cache.
4. On cache miss, it submits a job to `VoxelWorkerPool`.
5. A worker parses one or more `.region` files, generates a greedy mesh, and returns a binary payload plus metrics.
6. The service drops stale results using epoch-based invalidation, computes an ETag, caches the response, and returns it.
7. The route exposes timing and queue metrics through response headers.

This design keeps expensive voxel meshing off the main server thread.

## Real-Time Update Flow

### Save watching

`SaveWatcher` monitors:

- `maps/`
- `chunks/`
- `players/`
- `world.zig.zon`

It emits these high-level events:

- `players-updated`
- `world-updated`
- `surface-index-changed`
- `terrain-updates-batch`

`terrain-updates-batch` groups tile and region changes over a configurable window so the client is not flooded with per-file events.

### Broadcast and invalidation

When `index.ts` receives watcher events:

1. terrain tile cache entries are invalidated for changed surface tiles
2. voxel mesh cache entries are invalidated for changed voxel regions
3. broad terrain changes can trigger a throttled full voxel cache clear
4. the event is broadcast to all connected WebSocket clients

This allows the client to refresh only the affected world data.

## Caching Strategy

### Terrain tiles

- cached in memory via `LRUCache`
- invalidated by source file modification time
- unexplored areas are not permanently cached as rendered data

### Voxel meshes

- cached in memory by `lod/regionX/regionY`
- deduplicated across concurrent requests using an in-flight map
- protected against stale writes with global and per-key epochs
- exposed with ETags so clients can revalidate cheaply
- can also persist generated mesh payloads on disk via `VOXEL_CACHE_DIR` for faster warm restarts and container reuse

### Logs and runtime paths

- `SAVE_PATH` points to the Cubyz save directory
- `CUBYZ_PATH` points to the Cubyz project or asset root
- `LOG_DIR` controls where Winston file logs are written
- `VOXEL_CACHE_DIR` controls the persistent voxel mesh disk cache location
- `CORS_ALLOWED_ORIGINS` lists explicit browser origins allowed to call the server

In containerized deployments, save data and Cubyz assets are intended to be mounted read-only, while logs and voxel cache are intended to be mounted read-write.

## WebSocket Role

The WebSocket server at `/ws` does not stream world data directly. It streams change notifications.

The client still fetches fresh data through HTTP. This keeps responsibilities clear:

- HTTP provides authoritative world payloads
- WebSocket provides low-latency invalidation signals

## Design Principles

- keep parsing separate from HTTP transport
- use workers for CPU-heavy voxel generation
- prefer targeted invalidation over full rebuilds
- batch filesystem churn before broadcasting it to clients
- expose enough metrics to debug voxel throughput and latency

## Validation

- `npm run check` runs Biome over the repository.
- `npm run typecheck` runs TypeScript against both the shared and server-specific configs.
- `npm run build` produces the client bundle and server output.
