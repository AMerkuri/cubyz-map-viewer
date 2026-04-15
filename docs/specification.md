# Cubyz Map Viewer Specification

## Overview

Cubyz Map Viewer is an interactive terrain and voxel map viewer for Cubyz worlds. It renders 3D terrain, 3D voxel regions, player markers, spawn markers, and live save updates.

## Features

- Terrain view for surface tiles and biome labels
- Voxel view for streamed 3D region meshes
- Seam-aware voxel ambient occlusion with runtime intensity tuning for top faces on `L1` and `L2`
- Live updates from save-file changes over WebSocket
- Player and spawn markers, including model-backed 3D player markers
- Debug stats, rendering controls, loading spinner feedback, and voxel tuning parameters

## Shared Behavior

- HTTP provides authoritative world payloads.
- WebSocket provides low-latency change notifications only.
- World coordinates use `X/Y` horizontally and `Z` vertically.
- Voxel payloads preserve direct world coordinates, so the client does not mirror an axis.
- Surface tiles come from `maps/{lod}/{worldX}/{worldY}.surface`.
- Region voxel data comes from `chunks/{lod}/{worldX}/{worldY}/{worldZ}.region`.
- Supported surface LODs are `1, 2, 4, 8, 16, 32`.
- Terrain tile fetches and mesh builds are queued on the client and applied within a per-frame budget to avoid zoom-time stalls.
- Save watching batches filesystem churn into grouped update events.

## Runtime Requirements

- Node.js with `npm`
- A Cubyz save directory
- A local clone of `https://github.com/PixelGuys/Cubyz` for `CUBYZ_PATH`

## Runtime Configuration

The root `.env.example` mirrors the server config list.

- `PORT`: HTTP bind port (`3001`)
- `HOST`: HTTP bind address (`0.0.0.0`)
- `VOXEL_MEMORY_CACHE_SIZE`: in-memory voxel mesh cache size (`1024` recommended for hosting)
- `VOXEL_FULL_CLEAR_THROTTLE_MS`: minimum gap in ms between broad voxel cache clears (`1000`)
- `TERRAIN_UPDATE_BATCH_MS`: save watcher batch window in ms for terrain updates (`15000`)
- `CORS_ALLOWED_ORIGINS`: comma-separated browser origin allowlist
- `SAVE_PATH`: Cubyz save directory; auto-detects the newest directory under `~/.cubyz/saves/` when unset
- `CUBYZ_PATH`: Cubyz project root or asset source; auto-detects the repository parent containing `assets/cubyz` when unset
- `VOXEL_WORKERS`: voxel worker pool size; defaults to `floor(availableParallelism() / 2)` workers
- `VOXEL_CACHE_DIR`: persistent voxel mesh cache directory (`dist/server/cache/voxels`)
- `LOG_DIR`: Winston file log directory for rotated logs (`logs`)
- `LOG_REQUESTS`: enables the rotated `server-requests.log` transport when set to `true`
- `LOG_LEVEL`: Winston log level (`info`)

The server rotates file logs at 20 MiB, keeps 14 archives per transport, and gzip-compresses rotated files.

## Commands

- `npm run dev`
- `npm run dev:server`
- `npm run dev:client`
- `npm run check`
- `npm run check:write`
- `npm run typecheck`
- `npm run build`
- `npm start`

## Deployment

The production container serves the built client and API/WebSocket server from a single Node.js process on port `3000`.

- save data mounted read-only at `/data/save`
- Cubyz assets mounted read-only at `/data/cubyz`
- persistent voxel cache mounted read-write at `/data/cache`
- logs mounted read-write at `/data/logs`; rotated archives are gzip-compressed

Build the image:

```bash
docker build -t cubyz-map-viewer .
```

Run it directly:

```bash
docker run --rm -p 3000:3000 \
  -e SAVE_PATH=/data/save \
  -e CUBYZ_PATH=/data/cubyz \
  -e VOXEL_CACHE_DIR=/data/cache/voxels \
  -e LOG_DIR=/data/logs \
  -e LOG_LEVEL=info \
  -v /path/to/your/save:/data/save:ro \
  -v /path/to/Cubyz:/data/cubyz:ro \
  -v cubyz-map-viewer-cache:/data/cache \
  -v cubyz-map-viewer-logs:/data/logs \
  cubyz-map-viewer
```

Or with Compose:

```bash
docker compose up --build
```

`compose.yml` uses fixed container paths and expects its bind-mount sources to be edited for your machine.

## Verification

- `curl http://localhost:3001/api/health`
- `curl http://localhost:3001/api/world`

## Documentation

- `docs/client-specification.md`
- `docs/server-specification.md`
