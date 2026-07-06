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
- `src/client/features/world-controls/`: voxel scene layer visibility, graphics/debug settings, chunk stats/loading breakdown, loading overlay, and `localStorage` persistence
- `src/client/features/world-view/`: data hooks, WebSocket hook, scene/runtime code, terrain and voxel loading, labels, markers, and the browser worker
- `src/client/lib/`, `src/client/hooks/`, `src/client/types/`, `src/client/utils/`: shared client infrastructure used across features

## Runtime Model

- React Query is the source of truth for HTTP data. `main.tsx` sets `staleTime: Infinity`, so refresh is event-driven rather than focus-driven.
- The world viewer initializes as a voxel scene for every page load. Legacy `mode` URL parameters are ignored, and the HUD does not expose a terrain/voxel selector.
- Copied location URLs are camera-only: they include position, zoom, theta, and phi parameters, and they do not include world-view mode state.
- `useWorldData()` always loads world metadata, the surface index, the save block palette, and the voxel chunk index during initial page load so voxel rendering prerequisites are available immediately.
- `useWebSocket()` maintains the `/ws` connection, and `useWorldViewRefreshSubscriptions()` maps socket events to query invalidation.
- `WorldControlsProvider` owns low-frequency UI state and persists graphics/layer settings through `src/client/lib/world-view-storage.ts`; older stored versions are discarded and the app falls back to defaults.
- Chunk stats are published continuously from the scene runtime so loading UI can stay accurate even when debug overlays are off.
- The loading overlay appears immediately when work starts, stays visible for a short linger after work completes, and uses a compact green cube on mobile.
- `World3DView.tsx` keeps scene state in refs and delegates most runtime work to `features/world-view/lib/`; avoid moving per-frame state into React state.
- Voxel loading uses bounded fetch/build queues plus warm caches to avoid rebuilding everything during camera movement. Terrain loading remains available for the optional terrain underlay and terrain-derived labels.
- `src/client/features/world-view/workers/voxel-mesh.worker.ts` decodes voxel mesh payloads off the main thread before Three.js upload.
- The voxel worker reads fixed-point `u32` X/Y/Z vertex positions in `1/4096` voxel-cell units and converts them to world coordinates with `origin + fixed * voxelSize / 4096`, so explicit non-cube model quads flow through the same quadrant mesh, normal, color, bounds, and chunk-top-height builders as greedy cube quads.
- The voxel worker decodes per-quad block palette indices and render-kind values, splits opaque and transparent quads into separate quadrant mesh arrays, and preserves palette indices as per-triangle metadata on both streams. Cursor raycasts use `intersection.faceIndex` to resolve the selected voxel triangle to a palette index and then to a block ID from the loaded save block palette.
- Server-generated Cubyz rotation semantic geometry uses the same voxel binary payload and fixed-point decode path as static non-cube model quads; no browser-side Cubyz asset loading or semantic decoding is required.
- Opaque voxel meshes use the existing baked vertex-color material path. Transparent voxel meshes use a separate material with transparent blending and `depthWrite` disabled so opaque geometry behind glass remains visible with an approximate accumulated tint.
- The voxel worker excludes transparent top faces from chunk-top-height coverage used by terrain-underlay and label behavior, so transparent-only glass roofs do not fully occlude the terrain underlay.
- The cursor HUD shows `X/Y/Z` coordinates for terrain and voxel hits. In advanced mode, rendered voxel mesh hits with a resolvable palette index show the saved block ID on a second row before LOD/region debug details; terrain underlay hits, missing palette mappings, and non-advanced mode remain coordinate-only.
- Voxel AO is split between server and client responsibilities: the server packs per-quad AO for LOD `1/2` top faces and concave vertical wall corners, while the client applies the final wall shading directly, uses separate debug intensities for top and wall AO, and still softens top-face AO near active LOD boundaries after visibility selection.
- Player marker model assets are loaded lazily per avatar model ID when player markers are needed. `World3DView.tsx` collects the distinct `entityModelId` values among current players (plus the default `cubyz:snale`) and `lib/avatar-assets.ts` requests `/api/assets/player-marker/:entityModelId`, loads the manifest-provided GLB with `GLTFLoader` and texture with `TextureLoader`, and caches per-avatar load state, normalized template, active texture, and inactive grayscale texture in an imperative map keyed by `entityModelId`.
- `syncPlayerMarkers` renders each player with the marker model for their own `entityModelId`, falling back to the default `cubyz:snale` model when the player's own avatar is not loadable. Markers are recreated when a player's resolved avatar model ID, active/inactive state, or underground state changes.
- If an avatar manifest request fails, returns `available: false`, or the referenced GLB/PNG cannot be loaded (a per-model failure retries once), that player renders the default avatar or the existing fallback dot marker; unrelated players keep their own markers and the world view keeps working.

## Change-Sensitive Facts

- Terrain invalidation is wider than a single tile: terrain payloads depend on the same-LOD 3x3 neighborhood because the server includes a 1-vertex gutter for seam-safe normals.
- If WebSocket event names or `terrain-updates-batch` payload shape change, update `useWebSocket()`, `useWorldViewRefreshSubscriptions()`, the server broadcaster, and docs together.
- The mobile/compact HUD reuses the same controls/debug/info content as desktop; loading overlay visuals may differ by viewport, but the visibility and progress source stay shared.
- Player marker model URLs are server-provided manifest URLs. Do not hardcode Cubyz asset paths in the client.
- If worker files or worker import paths move, run `npm run build`; the worker URL/bundling path is easy to break silently.

## Related Docs

- `docs/architecture-overview.md`: shared client/server contracts
- `docs/server-specification.md`: route, watcher, and payload behavior consumed by the client
