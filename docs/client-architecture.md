# Client Architecture

## Purpose

The client is a React 19 application that renders the Cubyz world in two modes:

- terrain mode: surface tiles and biome labels
- voxel mode: streamed 3D voxel meshes with terrain underlay support

The client is intentionally thin on global abstractions. Most domain code lives inside the `world-view` feature, while shared UI stays in `shared/ui`.

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

## Main Entry Points

### `src/client/main.tsx`

- boots React
- creates the shared React Query client
- renders `App`

### `src/client/app/App.tsx`

`App` is the application composition layer. It owns:

- current view mode (`terrain` or `voxel`)
- URL-derived initial camera state
- share-location state
- layer visibility toggles
- voxel graphics preset selection and matching
- debug panel state and chunk stats display
- overlay panel placement and the bottom-right voxel loading indicator state
- wiring between data hooks, WebSocket events, and `World3DView`

`App` does not perform low-level Three.js work. It passes data and callbacks down into the world-view feature.

## Feature Layout

### `features/world-view/components`

Feature-facing React components:

- `World3DView.tsx`: the main 3D scene root
- `InfoPanel.tsx`: world metadata and player list
- `LayerControls.tsx`: visibility toggles and voxel-mode preset entry area
- `ViewToggle.tsx`: terrain/voxel mode switch
- `MapDebugParameters.tsx`: runtime debug tuning controls and direct voxel rendering sliders

### `features/world-view/hooks`

Domain hooks for fetching and live updates:

- `useWorldData.ts`: fetches world metadata, surface index, and chunk index with React Query
- `usePlayers.ts`: fetches player data and supports refresh invalidation
- `useWebSocket.ts`: maintains the `/ws` connection and dispatches watch events to subscribers

These hooks form the bridge between the UI and the server API.

### `features/world-view/lib`

Non-visual implementation details for the 3D world viewer:

- scene bootstrap and frame loop
- camera behavior and cursor interaction
- terrain tile loading and LOD management
- voxel request scheduling, caching, and mesh assembly
- marker, biome label, and debug label helpers
- effect hooks used by `World3DView`
- shared feature types and constants

This folder contains most of the imperative Three.js code.

### `features/world-view/workers`

- `voxel-mesh.worker.ts`: transforms binary voxel mesh data into typed arrays off the main thread

The worker keeps geometry decoding and normal generation away from the render thread.

### `features/world-view/debug.ts`

Defines:

- debug tuning parameters
- default debug values
- chunk statistics shape

This module is shared between `App`, the debug controls, and the 3D runtime.

## Rendering Model

The client uses React for composition and state, but the 3D scene is managed imperatively.

### React responsibilities

- fetch data and store UI state
- mount the 3D container
- render overlay panels and controls
- subscribe to WebSocket updates

### Three.js responsibilities

- maintain renderer, scene, camera, and orbit controls
- manage terrain meshes, voxel meshes, labels, and markers
- run the animation loop
- update visibility and LOD without React re-renders

`World3DView.tsx` is the boundary between these two worlds.

## Data Flow

### Initial load

1. `main.tsx` creates the React Query client and renders `App`.
2. `App` calls `useWorldData`, `usePlayers`, and `useWebSocket`.
3. `World3DView` initializes the Three.js scene once world data is available.
4. Terrain tiles and, when enabled, voxel regions are loaded based on camera position, mode, and the voxel rendering controls currently selected directly or through voxel graphics presets.
5. `App` also controls the overlay layout: `Map Controls` defaults to top-left, `Stats` and `Parameters` default to the top-right stack, and a lightweight spinner-only voxel loading indicator appears in the bottom-right while stats are hidden.

### Terrain mode

1. `useWorldData` fetches `/api/world` and `/api/world/surface-index`.
2. `World3DView` requests terrain tiles as needed.
3. Terrain meshes, markers, and biome labels are refreshed based on camera motion and toggles.

### Voxel mode

1. `App` enables chunk index loading.
2. `useWorldData` also fetches `/api/world/chunk-index`.
3. The voxel runtime selects requested regions based on camera focus, distance, render distance, the minimum allowed voxel LOD, and any preset-applied loading or cache tuning.
4. `/api/voxels/:lod/:regionX/:regionY` responses are decoded and queued.
5. The feature worker converts raw mesh buffers into typed arrays.
6. The main thread uploads those arrays into Three.js geometries within a frame budget.
7. A lightweight voxel-loading signal is published back to `App` so the UI can show a bottom-right loading indicator even when the debug stats panel is hidden.

## Live Update Flow

1. `useWebSocket` connects to `/ws`.
2. The server broadcasts watch events such as:
   - `players-updated`
   - `world-updated`
   - `surface-index-changed`
   - `terrain-updates-batch`
3. `App` subscribes to those events.
4. Query-backed data is invalidated and refetched. Player data also falls back to a 30-second background refresh if no `players-updated` socket event arrives.
5. `World3DView` also listens for terrain and voxel region update events and refreshes loaded scene data in place, while player-list changes rebuild an OBJ-model-backed player marker layer and colorized player labels without recreating the full scene.

This keeps the UI responsive without a full scene rebuild.

## Shared UI

### `shared/ui/OverlayPanel.tsx`

This is the main shared client primitive. It provides:

- draggable overlay panels
- collapse support
- viewport snapping
- consistent panel styling

Other client components are currently feature-specific rather than generic shared UI.

## Design Principles

- keep feature code inside `world-view` unless it is truly reusable
- keep React responsible for composition, not per-frame 3D updates
- prefer direct imports over barrels
- use workers and bounded queues for heavy voxel processing
- avoid React re-renders for high-frequency cursor and frame-loop updates

## Validation

- `npm run check` runs Biome over the repository.
- `npm run typecheck` runs TypeScript against both the shared and server-specific configs.
- `npm run build` produces the client bundle and server output.
