# Cubyz Map Viewer – Agent Guide

- Work only inside `cubyz-map-viewer/`. Do not modify the parent `Cubyz` repo from this workspace.
- Keep docs in sync with behavior. If you change client/server contracts, runtime flow, or contributor workflow, update the matching file in `docs/` in the same task.
- Shared contract changes must update `docs/architecture-overview.md` plus the affected side doc (`docs/client-specification.md` or `docs/server-specification.md`).

## Read First

- `package.json`: real commands and release entrypoints
- `biome.json`: formatter/linter/import ordering behavior
- `vite.config.ts`: client proxying and build output
- `src/client/app/components/WorldViewPageContent.tsx`: app-level composition
- `src/client/features/world-view/components/World3DView.tsx`: real scene/runtime boundary
- `src/server/index.ts`: server composition root, path resolution, WebSocket wiring, watcher wiring, optional voxel warmup

## Commands

- `npm run dev`: starts server and client together
- `npm run dev:server`: runs the Express server through `tsx watch`
- `npm run dev:client`: Vite dev server on `:5173`
- `npm run check`: Biome
- `npm run check:write`: Biome with fixes
- `npm run check:knip`: unused exports/dependencies check
- `npm run typecheck`: client and server TS configs
- `npm run build`: Vite client build plus `tsc -p tsconfig.server.json`
- `npm test`: all hermetic voxel and core-mechanics correctness suites
- `npm run test:voxel:server`, `npm run test:voxel:client`, `npm run test:voxel:contract`: focused correctness groups
- `npm run test:core:service-api`, `npm run test:core:watcher`, `npm run test:core:client`, `npm run test:core:terrain`: focused service/API, watcher, live-update, and terrain seam groups
- `npm run bench:voxel:server`, `npm run bench:voxel:client`: opt-in serial benchmarks; timing is observational, not a pass/fail budget
- `npm start`: runs `dist/server/index.js`

## Verification Order

- Default for code changes: `npm test && npm run check && npm run check:knip && npm run typecheck`
- Also run `npm run build` when changing build paths, worker wiring, route payloads, or TypeScript boundaries.
- There is no test runner configured.

## Runtime Gotchas

- The server does not load `.env` files automatically.
- `SAVE_PATH` and `CUBYZ_PATH` can be set by env var or `--save` / `--cubyz` CLI args.
- If `SAVE_PATH` is unset, the server auto-picks the newest directory under `~/.cubyz/saves/`.
- If `CUBYZ_PATH` is unset, the server expects the parent of this repo to contain `assets/cubyz`.
- Vite proxies `/api` to `http://localhost:3001` and `/ws` to `ws://localhost:3001`.
- Voxel requests require `br` or `gzip`; `/api/voxels` returns `406` if the client does not advertise one of them.

## Structure That Matters

- `src/client/main.tsx` creates the shared React Query client.
- `src/client/app/` composes features; keep cross-feature wiring there.
- `src/client/features/world-controls/` owns control state, persistence, and HUD controls.
- `src/client/features/world-view/` owns the Three.js scene, data loading/runtime, labels, markers, and the browser worker.
- `World3DView.tsx` is intentionally imperative and ref-heavy; avoid pushing per-frame scene state into React state.
- `test/core/` owns hermetic runtime mechanics tests. Use fakes or temporary fixtures instead of a real save, browser, WebGL context, Cubyz installation, or running server.
- `src/server/index.ts` is the only real server composition root.
- Keep server layering clear: `api/` for HTTP/WebSocket boundary logic, `parsers/` for file decoding, `services/` for runtime/business logic, `workers/` for voxel worker entrypoints/protocol.
- Routes should go through `VoxelMeshService`; do not bypass it when serving voxel payloads.

## Repo Conventions

- ESM everywhere: local imports use the `.js` extension.
- Use named exports.
- Prefer relative imports even though `tsconfig.json` defines `@client/*` and `@server/*` paths.
- Biome organizes imports; if check failures are only ordering, use `npm run check:write`.
- Knip is enforced without `ignoreExportsUsedInFile`; keep module-local helpers/types unexported unless another file imports them.

## Worker And Build Notes

- Client worker: `src/client/features/world-view/workers/voxel-mesh.worker.ts`.
- Server worker entrypoints: `src/server/workers/voxel-worker.ts` and `src/server/workers/voxel-worker-dev.js`.
- Dev server uses the source worker through the `tsx` bootstrap; production uses the built worker under `dist/server/workers/`.
- If you move worker-related files or import paths, run `npm run build` before finishing.

## Binary / Contract Facts

- Coordinate convention is `X,Y` horizontal and `Z` vertical.
- Surface tiles: `maps/{lod}/{worldX}/{worldY}.surface`
- Region voxel data: `chunks/{lod}/{worldX}/{worldY}/{worldZ}.region`
- Supported LODs: `1, 2, 4, 8, 16, 32`
- `MAP_SIZE = 256`
- WebSocket event names are `players-updated`, `world-updated`, `surface-index-changed`, and `terrain-updates-batch`.

## Release / Ops

- Release automation is local-script driven, not CI-driven: `npm run release*` calls `scripts/release.sh`.
- Releases require a clean worktree on `master` and run `check`, `check:knip`, and `typecheck` before tagging/pushing.
- Image publishing goes through `scripts/build-and-push.sh` and infers `GITHUB_REPOSITORY` / `GITHUB_ACTOR` from `origin` when possible.
