# Cubyz Map Viewer

Interactive terrain and voxel map viewer for Cubyz worlds.

## Attribution

This project uses Cubyz assets and world data formats. Cubyz is licensed under GPLv3; see `LICENSE` for the
viewer's license text.

## Features

- Terrain view for surface tiles and biome labels
- Voxel view for streamed 3D region meshes
- Live updates from save-file changes over WebSocket
- Player and spawn markers, including model-backed 3D player markers
- Debug stats, rendering controls, and voxel tuning parameters

## Requirements

- A recent Node.js version with `npm`
- A Cubyz save directory
- Access to Cubyz assets

## Install

```bash
npm install
```

## Development

Start both the server and client:

```bash
npm run dev
```

Split mode:

```bash
npm run dev:server
npm run dev:client
```

Default local URLs:

- Client: `http://localhost:5173`
- Server: `http://localhost:3001`

## Configuration

The server auto-detects a save under `~/.cubyz/saves/` by default.

Override paths with environment variables:

```bash
SAVE_PATH=/path/to/save CUBYZ_PATH=/path/to/Cubyz npm run dev:server
```

Or with CLI args:

```bash
npm run dev:server -- --save /path/to/save --cubyz /path/to/Cubyz
```

## Commands

```bash
npm run dev
npm run dev:server
npm run dev:client
npm run check
npm run check:write
npm run build
npm start
```

## Docker

The production container runs a single Node.js process that serves both the built client and the API/WebSocket server on port `3001`.

Build the image:

```bash
docker build -t cubyz-map-viewer .
```

Run it directly:

```bash
docker run --rm -p 3001:3001 \
  -e SAVE_PATH=/data/save \
  -e CUBYZ_PATH=/data/cubyz \
  -e VOXEL_CACHE_DIR=/data/cache/voxels \
  -e LOG_DIR=/data/logs \
  -v /path/to/your/save:/data/save:ro \
  -v /path/to/Cubyz:/data/cubyz:ro \
  -v cubyz-map-viewer-cache:/data/cache \
  -v cubyz-map-viewer-logs:/data/logs \
  cubyz-map-viewer
```

Or with Compose using `compose.yml`:

```bash
docker compose up --build
```

`compose.yml` uses fixed container paths:

- save: `/data/save`
- Cubyz checkout: `/data/cubyz`
- cache: `/data/cache`
- logs: `/data/logs`

Edit the two bind-mount source paths in `compose.yml` to match your machine, then run:

```bash
docker compose up --build
```

If you previously created the named volumes before this permissions fix, remove them once so Docker can recreate them from the updated image:

```bash
docker compose down -v
docker compose up --build
```

Recommended volume mapping:

- save data: bind mount of your save directory, read-only
- Cubyz root/assets: bind mount, read-only
- persistent voxel cache: named volume at `/data/cache`
- logs: named volume at `/data/logs`

Supported runtime env vars include:

- `SAVE_PATH`
- `CUBYZ_PATH`
- `VOXEL_CACHE_DIR`
- `LOG_DIR`
- `CACHE_SIZE`
- `VOXEL_WORKERS`
- `TERRAIN_UPDATE_BATCH_MS`
- `VOXEL_FULL_CLEAR_THROTTLE_MS`

## Verification

- `npm run check` runs Biome
- `npm run build` builds the Vite client and compiles the server
- There is no separate test runner configured

Useful manual checks:

```bash
curl http://localhost:3001/api/health
curl http://localhost:3001/api/world
curl -o tile.png http://localhost:3001/api/tiles/1/8/3.png
```

## Architecture

- Client architecture: `docs/client-architecture.md`
- Server architecture: `docs/server-architecture.md`

## Project Layout

```text
src/client/    React app and Three.js viewer
src/server/    Express API, WebSocket server, save watcher
docs/          Architecture documentation
```
