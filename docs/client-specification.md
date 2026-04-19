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
- `src/client/features/world-controls/`: mode, layer visibility, graphics/debug settings, chunk stats/loading breakdown, and `localStorage` persistence
- `src/client/features/world-view/`: data hooks, WebSocket hook, scene/runtime code, terrain and voxel loading, labels, markers, and the browser worker
- `src/client/lib/`, `src/client/hooks/`, `src/client/types/`, `src/client/utils/`: shared client infrastructure used across features

## Runtime Model

- React Query is the source of truth for HTTP data. `main.tsx` sets `staleTime: Infinity`, so refresh is event-driven rather than focus-driven.
- `useWorldData()` always loads world metadata and the surface index. Chunk-index loading stays disabled until voxel mode is entered.
- `useWebSocket()` maintains the `/ws` connection, and `useWorldViewRefreshSubscriptions()` maps socket events to query invalidation.
- `WorldControlsProvider` owns low-frequency UI state and persists graphics/layer settings through `src/client/lib/world-view-storage.ts`.
- `World3DView.tsx` keeps scene state in refs and delegates most runtime work to `features/world-view/lib/`; avoid moving per-frame state into React state.
- Terrain and voxel loading both use bounded fetch/build queues plus warm caches to avoid rebuilding everything during camera movement.
- `src/client/features/world-view/workers/voxel-mesh.worker.ts` decodes voxel mesh payloads off the main thread before Three.js upload.

## Change-Sensitive Facts

- Terrain invalidation is wider than a single tile: terrain payloads depend on the same-LOD 3x3 neighborhood because the server includes a 1-vertex gutter for seam-safe normals.
- If WebSocket event names or `terrain-updates-batch` payload shape change, update `useWebSocket()`, `useWorldViewRefreshSubscriptions()`, the server broadcaster, and docs together.
- The mobile/compact HUD reuses the same controls/debug/info content as desktop; prefer changing shared content rather than forking behavior by viewport.
- If worker files or worker import paths move, run `npm run build`; the worker URL/bundling path is easy to break silently.

## Related Docs

- `docs/architecture-overview.md`: shared client/server contracts
- `docs/server-specification.md`: route, watcher, and payload behavior consumed by the client
