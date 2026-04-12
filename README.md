# Cubyz Map Viewer

Interactive terrain and voxel map viewer for Cubyz worlds.

## Attribution

This project uses Cubyz assets and world data formats. Cubyz is licensed under GPLv3; see `LICENSE` for the
viewer's license text.

## Requirements

- Node.js with `npm`
- A Cubyz save directory
- A local clone of [`PixelGuys/Cubyz`](https://github.com/PixelGuys/Cubyz) for `CUBYZ_PATH`

## Quick Start

```bash
npm install
npm run dev
```

Default local URLs:

- Client: `http://localhost:5173`
- Server: `http://localhost:3001`

Split mode:

```bash
npm run dev:server
npm run dev:client
```

If you need explicit paths, set them before starting the server:

```bash
SAVE_PATH=/path/to/save CUBYZ_PATH=/path/to/Cubyz npm run dev:server
```

The server does not auto-load `.env` files, so export variables in your shell or set them in your process manager.

## Docker Deployment

The production container runs a single Node.js process that serves the built client and the API/WebSocket server on port `3000`.

`SAVE_PATH` and `CUBYZ_PATH` are required for deployment and must point to valid Cubyz save and asset paths.

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

Edit the bind-mount source paths in `compose.yml` to match your machine, then run Compose.
