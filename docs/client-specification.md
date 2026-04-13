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
- `src/client/app/App.tsx`: owns the current view mode, initial camera state, share-location state, layer visibility, voxel preset selection, debug state, and overlay placement

## World-View Feature

- `features/world-view/components`: scene UI, info panel, controls, mode toggle, and debug parameters
- `features/world-view/hooks`: world data, player data, and WebSocket hooks
- `features/world-view/lib`: scene bootstrap, camera behavior, terrain loading, voxel scheduling, labels, markers, and feature types
- `features/world-view/workers`: `voxel-mesh.worker.ts` decodes mesh data off the main thread
- `features/world-view/debug.ts`: debug tuning defaults and chunk stats shape

## Rendering Model

- React handles composition, data fetching, overlays, and socket subscription
- Three.js handles the renderer, scene, camera, controls, meshes, labels, markers, and animation loop
- `World3DView.tsx` is the boundary between those two layers

## Data Flow

### Initial Load

1. `main.tsx` creates the React Query client and renders `App`.
2. `App` loads world data, players, and the WebSocket connection.
3. `World3DView` initializes once world data is available.
4. Terrain and voxel resources load from camera position and the current mode.

### Terrain Mode

1. `useWorldData` fetches `/api/world` and `/api/world/surface-index`.
2. `World3DView` requests terrain tiles as needed.
3. Terrain meshes, markers, and biome labels refresh with camera motion and toggles.

### Voxel Mode

1. `App` enables chunk index loading.
2. `useWorldData` fetches `/api/world/chunk-index`.
3. The voxel runtime selects regions based on camera focus, distance, render distance, minimum voxel LOD, and preset tuning.
4. `/api/voxels/:lod/:regionX/:regionY` returns compressed binary payloads.
5. The worker converts mesh buffers into typed arrays.
6. The main thread uploads the data to Three.js geometries within a frame budget.
7. Cursor hover prefers voxel meshes and falls back to the terrain underlay when enabled, converting the underlay hit back to the terrain's real world height.

## Live Updates

1. `useWebSocket` connects to `/ws`.
2. The server broadcasts `players-updated`, `world-updated`, `surface-index-changed`, and `terrain-updates-batch`.
3. `App` invalidates query-backed data and falls back to a 30-second refresh for players if no socket event arrives.
4. `World3DView` refreshes loaded scene data in place, and player updates rebuild the marker layer without recreating the full scene.

## Shared UI

- `OverlayPanel.tsx` provides draggable, collapsible, snapping overlay panels with shared styling.

## Design Principles

- keep feature code in `world-view` unless it is truly reusable
- keep React responsible for composition, not per-frame 3D updates
- prefer direct imports over barrels
- use workers and bounded queues for heavy voxel processing
- avoid React re-renders for high-frequency cursor and frame-loop updates
