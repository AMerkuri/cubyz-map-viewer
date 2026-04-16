# Client Specification

## Overview

The client is a React 19 application that composes the UI and delegates 3D scene management to Three.js. It renders terrain mode and voxel mode from shared world data and the live update stream.

This document describes client-owned behavior. Shared contracts such as coordinates, LODs, transport roles, and event names are defined in `docs/architecture-overview.md`.

## Top-Level Structure

```text
src/client/
  app/
    App.tsx
  features/
    world-view/
      components/
      hooks/
      lib/
      workers/
      debug.ts
  shared/
    ui/
      OverlayPanel.tsx
  main.tsx
```

## Entry Points

- `src/client/main.tsx`: boots React and creates the shared React Query client
- `src/client/app/App.tsx`: owns the current view mode, initial camera state, share-location state, layer visibility, voxel preset selection, persisted graphics parameters, debug state, loading indicator state, overlay placement, and the lazy-loading boundary for optional debug UI. It composes local helpers for the toolbar, stats panel, controls panel, and debug-parameters panel around the main scene.

## World-View Feature

- `features/world-view/components`: scene UI, info panel, controls, mode toggle, and debug parameters
- `MapDebugParameters.tsx` is section-driven and reuses shared parameter-row chrome for sliders and resets, including performance controls for active and idle frame rate
- `features/world-view/hooks`: world data, player data, and WebSocket hooks
- `features/world-view/lib`: scene bootstrap, camera behavior, terrain loading, voxel scheduling, labels, markers, and feature types
- `features/world-view/workers`: `voxel-mesh.worker.ts` decodes mesh data off the main thread
- `features/world-view/debug.ts`: debug tuning defaults and chunk stats shape

## Rendering Model

- React handles composition, data fetching, overlays, and socket subscription
- Three.js handles the renderer, scene, camera, controls, meshes, labels, markers, and animation loop; the Parameters panel can cap that loop between `30` and `120` FPS, with an `Uncapped` stop shown to the right of `120` and stored internally as `0`
- When the scene is settled, no keyboard input is active, no work queues are pending, and the mouse is not hovering the canvas, the runtime can drop to a lower user-configured idle FPS after a short internal delay. Idle mode also uses a slower internal LOD polling interval.
- On startup, the client restores persisted graphics preset values and custom parameter overrides from `localStorage`, then keeps those settings in sync as the user changes voxel rendering and parameter-panel values
- Orbit controls enforce a small non-zero minimum camera distance so wheel zoom cannot get stuck at the target point
- `World3DView.tsx` is the boundary between those two layers
- `App.tsx` keeps `World3DView` eager so scene bootstrap stays deterministic, and lazy-loads the debug-parameters panel because it is optional UI

## Data Flow

### Initial Load

1. `main.tsx` creates the React Query client and renders `App`.
2. `App` loads world data, players, and the WebSocket connection.
3. `World3DView` initializes once world data is available.
4. Terrain and voxel resources load from camera position and the current mode.
5. Player marker model/texture assets load lazily once the player layer is visible or player data is present.
6. If the `snale` assets fail to load, the viewer retries once and falls back to a visible marker sprite so players stay visible on the map.

### Terrain Mode

1. `useWorldData` fetches `/api/world` and `/api/world/surface-index`.
2. `World3DView` selects desired terrain tiles from the surface index, keeps a synced set of active terrain requests, and only commits fine terrain refinement after camera motion has settled for a short debounce window. While moving, terrain stays on already-loaded or coarser fallback coverage instead of continuously chasing finer tiles.
3. Fetched terrain payloads carry a visible vertex grid plus a 1-vertex same-LOD gutter sampled from the tile neighborhood, and the client builds normals from that gutter so same-LOD lighting seams stay consistent across tile borders.
4. Coarser terrain tiles stay visible as fallback coverage until finer child tiles are ready, reducing zoom-in churn and visible popping.
5. Terrain meshes are converted into Three.js meshes within a per-frame build budget instead of immediately on fetch completion, and terrain fetches that drift out of the current desired set are aborted so stale movement work does not keep the spinner alive.
6. Recently unloaded terrain tiles stay in a bounded warm cache so nearby pans can reattach existing meshes instead of rebuilding them immediately. Voxel tiles keep their own warm cache limit.
7. Terrain chunk-border lines and LOD text sprites are created lazily only when chunk borders are actually shown.
8. Terrain meshes, markers, and biome labels refresh with camera motion and toggles; terrain and biome HTTP responses use 1-hour browser caching plus ETag revalidation when the browser checks again.

### Voxel Mode

1. `App` enables chunk index loading.
2. `useWorldData` fetches `/api/world/chunk-index`.
3. The voxel runtime selects regions based on camera focus, distance, render distance, minimum voxel LOD, and preset tuning.
4. `/api/voxels/:lod/:regionX/:regionY` returns compressed binary payloads with `max-age=0` and ETag revalidation.
5. The worker converts mesh buffers into typed arrays, bakes voxel face shading plus a wall depth gradient into base vertex colors, and keeps raw per-face AO separate from those base colors.
6. The main thread uploads the data to Three.js geometries within a frame budget and applies final seam-aware AO after voxel LOD visibility and parent-child fallback coverage are resolved. Top-face AO runs on `L1` and `L2`, while side faces currently rely on the baked face tint and depth cue only. The Parameters panel exposes a runtime AO intensity control for tuning the top-face effect.
7. The 3D runtime also publishes a lightweight loading breakdown every frame, and `App` uses it to drive the spinner even when debug stats are hidden.
8. Cursor hover prefers voxel meshes and falls back to the terrain underlay when enabled, converting the underlay hit back to the terrain's real world height.

## Live Updates

1. `useWebSocket` connects to `/ws` and exposes the last server update time plus typed subscriptions.
2. The server broadcasts `players-updated`, `world-updated`, `surface-index-changed`, and `terrain-updates-batch`.
3. `usePlayers` keeps player activity fresh with a 30-second refetch interval and also invalidates immediately on `players-updated` events.
4. Terrain tile refreshes invalidate the changed tile plus its same-LOD neighbors because seam-safe terrain payloads depend on a 3x3 tile neighborhood. `surface-index-changed` takes the simpler clear-and-rebuild path for visible terrain so add/remove changes cannot leave stale neighbor-dependent meshes alive.
5. `World3DView` refreshes loaded scene data in place, and player updates reconcile marker objects in place so frequent `players-updated` events do not remount all nameplates.
6. Player markers use the `snale` entity model when the asset load succeeds, otherwise they render a fallback sprite marker with the player label.
7. Spawn and player marker labels use bundled `unscii-8` / `unscii-16` fonts via client `@font-face` definitions.

## Shared UI

- `OverlayPanel.tsx` provides draggable, collapsible, snapping overlay panels with shared styling.
- Drag listeners are only attached while a panel is actively being moved.
- A panel reset button only appears after the panel has actually moved away from its default anchored position.
- The panel header disables native touch panning so overlays can be dragged on touch devices.
- The client UI defaults to the bundled `unscii-16` font, while spawn and player marker labels keep their own `unscii-8`-first stack for compact map readability.
- Shared panels and controls use a retro HUD treatment: square corners, stronger borders, dark brown glass surfaces with light blur, offset shadows, and square slider/thumb controls.

## Design Principles

- keep feature code in `world-view` unless it is truly reusable
- keep React responsible for composition, not per-frame 3D updates
- prefer direct imports over barrels
- use bounded queues and frame budgets for heavy terrain and voxel processing
- cap the shared render loop when lower idle CPU is preferable to max refresh-rate rendering
- prefer a lower idle frame rate once the scene is settled and the user is no longer interacting with the canvas
- avoid React re-renders for high-frequency cursor and frame-loop updates
- avoid publishing React state from the render loop unless the value actually changed

## Related Documentation

- `docs/architecture-overview.md` for shared system contracts
- `docs/server-specification.md` for the server-side routes, watcher flow, and payload generation this client consumes
