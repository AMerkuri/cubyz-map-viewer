# Client Specification

## Overview

The client is a React 19 application that composes the UI and delegates 3D scene management to Three.js. It renders terrain mode and voxel mode from shared world data and the live update stream.

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
- `src/client/app/App.tsx`: owns the current view mode, initial camera state, share-location state, layer visibility, voxel preset selection, debug state, loading-indicator state, overlay placement, and the lazy-loading boundary for optional debug UI. It composes smaller local helpers for the toolbar, stats panel, controls panel, and debug-parameters panel around the main scene.

## World-View Feature

- `features/world-view/components`: scene UI, info panel, controls, mode toggle, and debug parameters
- `MapDebugParameters.tsx` is section-driven and reuses a shared parameter-row chrome for sliders and resets
- `features/world-view/hooks`: world data, player data, and WebSocket hooks
- `features/world-view/lib`: scene bootstrap, camera behavior, terrain loading, voxel scheduling, labels, markers, and feature types
- `features/world-view/workers`: `voxel-mesh.worker.ts` decodes mesh data off the main thread
- `features/world-view/debug.ts`: debug tuning defaults and chunk stats shape

## Rendering Model

- React handles composition, data fetching, overlays, and socket subscription
- Three.js handles the renderer, scene, camera, controls, meshes, labels, markers, and animation loop
- `World3DView.tsx` is the boundary between those two layers
- `App.tsx` keeps `World3DView` eager so scene bootstrap stays deterministic, and lazy-loads the debug-parameters panel because it is optional UI

## Data Flow

### Initial Load

1. `main.tsx` creates the React Query client and renders `App`.
2. `App` loads world data, players, and the WebSocket connection.
3. `World3DView` initializes once world data is available.
4. Terrain and voxel resources load from camera position and the current mode.
5. Player marker model/texture assets load only once the player layer is visible or player data is present.

### Terrain Mode

1. `useWorldData` fetches `/api/world` and `/api/world/surface-index`.
2. `World3DView` selects desired terrain tiles from the surface index, queues fetches with a small concurrency limit, and drains them as the camera moves.
3. Fetched terrain payloads are converted into Three.js meshes within a per-frame build budget instead of immediately on fetch completion.
4. Coarser terrain tiles stay visible as fallback coverage until finer child tiles are ready, reducing zoom-in churn and visible popping.
5. Terrain meshes, markers, and biome labels refresh with camera motion and toggles.

### Voxel Mode

1. `App` enables chunk index loading.
2. `useWorldData` fetches `/api/world/chunk-index`.
3. The voxel runtime selects regions based on camera focus, distance, render distance, minimum voxel LOD, and preset tuning.
4. `/api/voxels/:lod/:regionX/:regionY` returns compressed binary payloads.
5. The worker converts mesh buffers into typed arrays, bakes voxel face shading plus a wall depth gradient into base vertex colors, and keeps raw per-face AO separate from those base colors.
6. The main thread uploads the data to Three.js geometries within a frame budget and applies final seam-aware AO after voxel LOD visibility and parent/child fallback coverage are resolved: top-face AO runs on `L1` and `L2`, while side faces currently rely on the baked face tint and depth cue only; the Parameters panel exposes a runtime AO intensity control for tuning the top-face effect.
7. The 3D runtime also publishes a lightweight loading breakdown every frame, and `App` uses it to drive the spinner even when debug stats are hidden.
8. Cursor hover prefers voxel meshes and falls back to the terrain underlay when enabled, converting the underlay hit back to the terrain's real world height.

## Live Updates

1. `useWebSocket` connects to `/ws` and exposes the last server update time plus typed subscriptions.
2. The server broadcasts `players-updated`, `world-updated`, `surface-index-changed`, and `terrain-updates-batch`.
3. `App` invalidates query-backed data and falls back to a 30-second refresh for players if no socket event arrives.
4. `World3DView` refreshes loaded scene data in place, and player updates rebuild the marker layer without recreating the full scene.

## Shared UI

- `OverlayPanel.tsx` provides draggable, collapsible, snapping overlay panels with shared styling.
- Drag listeners are only attached while a panel is actively being moved.

## Design Principles

- keep feature code in `world-view` unless it is truly reusable
- keep React responsible for composition, not per-frame 3D updates
- prefer direct imports over barrels
- use bounded queues and frame budgets for heavy terrain and voxel processing
- avoid React re-renders for high-frequency cursor and frame-loop updates
- avoid publishing React state from the render loop unless the value actually changed
