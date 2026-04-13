# Cubyz Map Viewer – Agent Guide

- Work only inside `cubyz-map-viewer/`. Do not modify the parent `Cubyz` game code when working on this repo.
- Keep documentation up to date. Whenever you change client or server behavior, structure, or workflows, update the corresponding files in `docs/` in the same task.
- Architecture docs live in:
  - `docs/specification.md`
  - `docs/client-specification.md`
  - `docs/server-specification.md`

## Read First

- `package.json` for the real dev/build/check commands
- `biome.json` for formatting and import-order behavior
- `vite.config.ts` for client dev-server proxying and build output
- `tsconfig.json` and `tsconfig.server.json` for client/server build boundaries
- `src/client/app/App.tsx` for client composition
- `src/server/index.ts` for server startup, routing, WebSocket, and watcher flow

## Commands

- `npm run dev` starts both server and client
- `npm run dev:server` runs the Express server via `tsx watch`
- `npm run dev:client` runs Vite on `:5173`
- `npm run check` runs Biome; use this as the main verification step for edits
- `npm run check:write` applies Biome fixes, including import ordering
- `npm run build` builds the Vite client and compiles `src/server` to `dist/server`
- `npm start` runs `dist/server/index.js`

## Runtime Paths And Args

- Server defaults to auto-detecting a save under `~/.cubyz/saves/`
- Override the save with `SAVE_PATH=/path/to/save npm run dev:server` or `--save /path/to/save`
- Override the Cubyz asset source with `CUBYZ_PATH=/path/to/Cubyz` or `--cubyz /path/to/Cubyz`
- Client dev requests to `/api` and `/ws` are proxied to `http://localhost:3001` by Vite

## Verification

- There is no test runner configured
- After code changes, run `npm run check` and `npm run typecheck`
- Run `npm run build` for changes that affect bundling, types, workers, routing, or path moves
- Manual smoke checks that match the repo:
  - `curl http://localhost:3001/api/health`
  - `curl http://localhost:3001/api/world`
  - `curl -o tile.png http://localhost:3001/api/tiles/1/8/3.png`

## Client Structure

- Client entrypoint: `src/client/main.tsx`
- App composition: `src/client/app/App.tsx`
- Main feature: `src/client/features/world-view/`
- Shared UI: `src/client/shared/ui/OverlayPanel.tsx`
- The Three.js scene is managed imperatively inside the `world-view` feature; avoid moving per-frame scene state into React state
- `features/world-view/workers/voxel-mesh.worker.ts` is part of the feature; if you move related files, re-check worker import URLs and run `npm run build`

## Server Structure

- `src/server/index.ts` is the composition root: path resolution, palette/biome loading, router registration, WebSocket setup, watcher setup, shutdown
- Server layering is real and should stay clear:
  - `api/`: HTTP validation and responses
  - `parsers/`: file format decoding only
  - `services/`: caches, rendering, watcher, voxel orchestration
  - `workers/`: voxel worker entrypoints/protocol
- `VoxelMeshService` handles voxel caching, in-flight dedupe, and worker-pool orchestration; be careful not to bypass it from routes
- `SaveWatcher` drives live updates; if you change watch event types or payloads, update both server and client WebSocket handling and docs

## Repo Conventions That Matter

- ESM everywhere: local imports require the `.js` extension
- Named exports only
- Use relative imports even though `@client/*` and `@server/*` are configured in `tsconfig.json`
- Biome enforces import organization; if `npm run check` fails only on import order, `npm run check:write` is the fast fix
- Build output is split across `dist/client` and `dist/server`

## Binary-Format Facts Worth Remembering

- Surface tiles come from `maps/{lod}/{worldX}/{worldY}.surface`
- Region voxel data comes from `chunks/{lod}/{worldX}/{worldY}/{worldZ}.region`
- Surface tile size is `MAP_SIZE = 256`
- Supported LODs are `1, 2, 4, 8, 16, 32`
- Coordinate convention used by the viewer is `X,Y` horizontal and `Z` vertical
