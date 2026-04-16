# Cubyz Map Viewer Architecture Overview

## Purpose

This document describes the system-level architecture and the shared contracts between the browser client and the Node.js server.

Keep cross-cutting behavior here. Client-only rendering details belong in `docs/client-specification.md`. Server-only API, watcher, cache, worker, and runtime configuration details belong in `docs/server-specification.md`. Deployment and container operations belong in `docs/deployment.md`.

## System Overview

Cubyz Map Viewer is an interactive terrain and voxel viewer for Cubyz worlds.

The system has three main runtime pieces:

- a React and Three.js browser client
- a Node.js server that reads Cubyz save data and exposes HTTP and WebSocket endpoints
- a Cubyz save directory and Cubyz assets that provide world, biome, block, and entity data

At a high level:

1. The client fetches authoritative world data over HTTP.
2. The server reads and transforms Cubyz save files into terrain, biome, player, and voxel payloads.
3. The client renders terrain mode and voxel mode from those payloads.
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
- the server generates payloads from `.region` files and keeps coordinate space in world units
- the client may apply final visibility-dependent shading after LOD coverage is resolved, so the payload structure and face-data semantics must stay aligned across both sides

### Live Update Contract

- save watching batches filesystem churn into grouped update events
- the main event names are `players-updated`, `world-updated`, `surface-index-changed`, and `terrain-updates-batch`
- `players-updated` is a server-side invalidation hint only: the server waits for a short quiet window, reloads `/api/players`, compares a semantic player snapshot, and only broadcasts when the player view state actually changed
- `/api/players` includes `isActive` as the server-owned player activity flag for client styling, while stale player removal uses a longer retention window
- if event names, payload shapes, or update semantics change, update the server, client, and docs together

## Documentation Map

- `docs/architecture-overview.md`: system overview and shared client/server contracts
- `docs/client-specification.md`: client architecture, rendering flow, state ownership, and live-update handling
- `docs/server-specification.md`: server architecture, route flows, watcher flow, caching, workers, and runtime configuration
- `docs/deployment.md`: image publishing, container runtime setup, mounts, and deployment troubleshooting
