# Cubyz Map Viewer

Interactive 3D terrain and voxel map viewer for Cubyz worlds, with realtime world syncing from the Cubyz save using REST and WebSocket updates. Includes LOD-aware terrain and voxel rendering, player and spawn markers, biome labels.

![Cubyz Map Viewer](https://raw.githubusercontent.com/AMerkuri/cubyz-map-viewer/refs/heads/master/assets/cubyz-map-viewer.png)

## Requirements

- Node.js with `npm`
- A Cubyz save directory
- A local clone of [`PixelGuys/Cubyz`](https://github.com/PixelGuys/Cubyz)

### Stack

- Client: React 19, TypeScript, Vite, Three.js, React Query
- Server: Node.js, Express, WebSocket (`ws`), Chokidar, Sharp, Winston
- Shared tooling: TypeScript, Biome formatter

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

If `SAVE_PATH` is not set, the server auto-detects the most recently modified save directory under `~/.cubyz/saves/`.

If `CUBYZ_PATH` is not set, the server checks the parent of this project directory and expects to find Cubyz assets at `assets/cubyz` there.

The server does not auto-load `.env` files, so export variables in your shell or set them in your process manager.

## Docker Deployment

The production container runs a single Node.js process that serves the built client and the API/WebSocket server on port `3000`.

For most deployments, use the published GHCR image with the checked-in [`compose.yml`](./compose.yml). It contains the minimal required setup.

The published image defaults to these container paths:

- save: `/data/save`
- Cubyz checkout: `/data/cubyz`
- cache: `/data/cache`
- logs: `/data/logs`

`compose.yml` uses those paths already. Edit the bind-mount source paths to match your machine, then deploy with Compose.

Recommended Docker environment variables:

- `VOXEL_PREGENERATE_ON_STARTUP=true` to warm the voxel cache in the background after startup instead of ondemand when clients request voxel regions
- `VOXEL_MEMORY_CACHE_SIZE=1024`; this is the default value. Increase it if the container has spare RAM and the save is larger. Decrease it on memory-constrained systems.

Helpful Compose commands:

```bash
# downloads the latest image before restarting the stack
docker compose pull

# recreates the container in the background and applies changed image, environment, or volume configuration
docker compose up -d --force-recreate

# follows container logs while the service starts or when you need to troubleshoot
docker compose logs -f
```

`compose.yml` uses the published image:

```bash
ghcr.io/amerkuri/cubyz-map-viewer:latest
```

If you want to build a local image instead:

```bash
docker build -t cubyz-map-viewer .
```

Then run it directly:

```bash
docker run --rm -p 3000:3000 \
  -v /path/to/your/save:/data/save:ro \
  -v /path/to/Cubyz:/data/cubyz:ro \
  cubyz-map-viewer
```

## Troubleshooting

### Terrain Not Loading

If terrain tiles do not load, the save may be missing higher LOD `.surface` files under `maps/`.

If that happens:

1. Open `world.zig.zon` in the save directory.
2. Set `biomeChecksum` to `0`.
3. Open the world in Cubyz.
4. Wait for the game to regenerate the map LODs.

Larger worlds take longer to finish generating the higher LOD map data.

### Voxel Chunks Have Holes In The Map

Cubyz does not save every explored chunk to disk. It mainly saves dirty chunks, such as chunks where blocks changed or other world state was updated.

Because of that, untouched explored terrain may be missing from the `.region` files and can appear as holes in the voxel layer.

The practical workaround is to enable the terrain underlay.

## Attribution

This project uses Cubyz assets and world data formats. Cubyz is licensed under GPLv3; see `LICENSE` for the
viewer's license text.

## Disclaimer

This project was developed with the assistance of LLMs (GPT-5.3-Codex, GPT-5.4). This code is provided "as-is"; use at your own risk.
