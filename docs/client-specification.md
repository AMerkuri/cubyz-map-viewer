# Client Specification

## Scope

This document covers client-owned architecture and runtime behavior. Shared contracts such as coordinates, LODs, and WebSocket event names live in `docs/architecture-overview.md`.

## Entry Points

- `src/client/main.tsx`: creates the shared React Query client and renders `App`
- `src/client/app/App.tsx`: thin root that renders `WorldViewPage`
- `src/client/app/components/WorldViewPageContent.tsx`: app composition root that wires controls state, HTTP data, WebSocket invalidation, scene callbacks, sharing, and HUD chrome
- `src/client/features/world-view/components/World3DView.tsx`: imperative Three.js runtime boundary
- `src/client/features/world-controls/WorldControlsProvider.tsx`: reducer-backed control state, persistence, and fly-to requests

## Ownership By Area

- `src/client/app/`: compose features together; keep cross-feature wiring here
- `src/client/features/world-controls/`: voxel-default view state, layer visibility, graphics/debug settings, chunk stats/loading breakdown, loading overlay, and `localStorage` persistence
- `src/client/features/world-view/`: data hooks, WebSocket hook, scene/runtime code, terrain and voxel loading, labels, markers, and the browser worker
- `src/client/lib/`, `src/client/hooks/`, `src/client/types/`, `src/client/utils/`: shared client infrastructure used across features

## Runtime Model

- React Query is the source of truth for HTTP data. `main.tsx` sets `staleTime: Infinity`, so refresh is event-driven rather than focus-driven.
- The world viewer initializes in voxel mode for missing, legacy terrain, voxel, or invalid `mode` URL parameters. The HUD does not expose a terrain/voxel selector.
- `useWorldData()` always loads world metadata, the surface index, and the voxel chunk index during initial page load so voxel rendering prerequisites are available immediately.
- `useWebSocket()` maintains the `/ws` connection, and `useWorldViewRefreshSubscriptions()` maps socket events to query invalidation.
- `WorldControlsProvider` owns low-frequency UI state and persists graphics/layer settings through `src/client/lib/world-view-storage.ts`; older stored versions are discarded and the app falls back to defaults.
- Chunk stats are published continuously from the scene runtime so loading UI can stay accurate even when debug overlays are off.
- The loading overlay appears immediately when work starts, stays visible for a short linger after work completes, and uses a compact green cube on mobile.
- `World3DView.tsx` keeps scene state in refs and delegates most runtime work to `features/world-view/lib/`; avoid moving per-frame state into React state.
- Terrain and voxel loading both use bounded fetch/build queues plus warm caches to avoid rebuilding everything during camera movement.
- `src/client/features/world-view/workers/voxel-mesh.worker.ts` decodes voxel mesh payloads off the main thread before Three.js upload.
- Voxel meshes use baked vertex colors with an unlit material, so voxel face contrast comes from the worker-generated colors plus AO rather than from runtime Lambert lighting.
- Voxel AO is split between server and client responsibilities: the server packs per-quad AO for LOD `1/2` top faces and concave vertical wall corners, while the client applies the final wall shading directly, uses separate debug intensities for top and wall AO, and still softens top-face AO near active LOD boundaries after visibility selection.
- Player marker model assets are loaded lazily when player markers are needed. `World3DView.tsx` requests `/api/assets/player-marker`, loads the manifest-provided GLB with `GLTFLoader`, loads the manifest texture with `TextureLoader`, and prepares active/inactive marker templates entirely in refs.
- If the player marker manifest is unavailable, says `available: false`, or the referenced GLB/PNG fails to load after the retry path, existing fallback dot markers and player labels continue to render.

## Change-Sensitive Facts

- Terrain invalidation is wider than a single tile: terrain payloads depend on the same-LOD 3x3 neighborhood because the server includes a 1-vertex gutter for seam-safe normals.
- If WebSocket event names or `terrain-updates-batch` payload shape change, update `useWebSocket()`, `useWorldViewRefreshSubscriptions()`, the server broadcaster, and docs together.
- The mobile/compact HUD reuses the same controls/debug/info content as desktop; loading overlay visuals may differ by viewport, but the visibility and progress source stay shared.
- Player marker model URLs are server-provided manifest URLs. Do not hardcode Cubyz asset paths in the client.
- If worker files or worker import paths move, run `npm run build`; the worker URL/bundling path is easy to break silently.

## Related Docs

- `docs/architecture-overview.md`: shared client/server contracts
- `docs/server-specification.md`: route, watcher, and payload behavior consumed by the client
