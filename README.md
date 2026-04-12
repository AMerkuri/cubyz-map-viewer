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

The root `.env.example` file mirrors the full server config list below.

The server does not auto-load `.env` files, so export variables in your shell or set them in your process manager.

The server auto-detects a save under `~/.cubyz/saves/` and a Cubyz checkout from the repo layout when `SAVE_PATH` and `CUBYZ_PATH` are unset.

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

The production container runs a single Node.js process that serves both the built client and the API/WebSocket server on port `3000`.

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

Recommended volume mapping:

- save data: bind mount of your save directory, read-only
- Cubyz root/assets: bind mount, read-only
- persistent voxel cache: named volume at `/data/cache`
- logs: named volume at `/data/logs`

Supported runtime env vars include:

- `PORT`: HTTP bind port (`3001`)
- `HOST`: HTTP bind address (`0.0.0.0`)
- `CACHE_SIZE`: in-memory terrain tile cache size (`500`)
- `VOXEL_FULL_CLEAR_THROTTLE_MS`: minimum gap in ms between full voxel cache clears after broad terrain updates (`1000`)
- `TERRAIN_UPDATE_BATCH_MS`: save watcher batch window in ms for terrain updates (`15000`)
- `CORS_ALLOWED_ORIGINS`: comma-separated allowlist of browser origins allowed to call the server
- `SAVE_PATH`: Cubyz save directory; auto-detects `~/.cubyz/saves/` when unset
- `CUBYZ_PATH`: Cubyz project root or asset source; auto-detects the repository parent containing `assets/cubyz` when unset
- `VOXEL_WORKERS`: voxel worker pool size; defaults to up to `min(4, availableParallelism() - 1)` workers
- `VOXEL_CACHE_DIR`: persistent voxel mesh cache directory (`dist/server/cache/voxels`)
- `LOG_DIR`: Winston file log directory (`logs`)
- `LOG_REQUESTS`: enables `server-requests.log` when set to `true` (default `false`)
- `LOG_LEVEL`: Winston log level for console and general file logging (`info` by default)

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
