# Client Specification

## Overview

The client is a React 19 application that composes the UI and delegates 3D scene management to Three.js. It renders terrain mode and voxel mode from shared world data and the live update stream.

This document describes client-owned behavior. Shared contracts such as coordinates, LODs, transport roles, and event names are defined in `docs/architecture-overview.md`.

The client follows a Bulletproof React-style project structure: application composition lives in `app/`, feature-specific code lives in `features/`, shared UI components live in `components/`, shared hooks in `hooks/`, reusable client infrastructure in `lib/`, shared type contracts in `types/`, and pure helpers in `utils/`. Reference: https://raw.githubusercontent.com/alan2207/bulletproof-react/refs/heads/master/docs/project-structure.md

## Top-Level Structure

```text
src/client/
  app/
    App.tsx
    components/
      CursorHud.tsx
      WorldViewHud.tsx
      WorldViewPage.tsx
      WorldViewPageContent.tsx
      WorldViewScene.tsx
    hooks/
      useWorldViewRefreshSubscriptions.ts
      useWorldViewShareLocation.ts
  components/
    OverlayPanel.tsx
  features/
    world-controls/
      components/
      WorldControlsProvider.tsx
    world-view/
      components/
      hooks/
      lib/
      workers/
  hooks/
    useCompactViewport.ts
  lib/
    ui-theme.ts
    world-view-debug.ts
    world-view-graphics-presets.ts
    world-view-storage.ts
    world-view-url-state.ts
  types/
    world-view.ts
  utils/
    world-view-formatters.ts
  main.tsx
```

## Entry Points

- `src/client/main.tsx`: boots React and creates the shared React Query client
- `src/client/app/App.tsx`: thin entry component that renders the world-view page
- `src/client/app/components/WorldViewPage.tsx`: bootstrap component that reads initial URL state and mounts the page-level provider tree
- `src/client/app/components/WorldViewPageContent.tsx`: application composition root that wires live data, controls state, share-location behavior, scene callbacks, and the desktop/mobile HUD shells
- `src/client/app/components/WorldViewScene.tsx`: thin adapter that connects app-level composition to `World3DView`
- `src/client/app/components/WorldViewHud.tsx`: app-level chrome that composes controls, info overlays, loading feedback, and the compact/mobile HUD
- `src/client/app/hooks/useWorldViewShareLocation.ts`: isolated clipboard/share-location state and URL generation flow
- `src/client/app/hooks/useWorldViewRefreshSubscriptions.ts`: isolated WebSocket-driven invalidation flow for world and index queries

## World-Controls Feature

- `features/world-controls/WorldControlsProvider.tsx`: owns the low-frequency viewer control state with a reducer-backed context, including view mode, per-mode layer visibility, persisted graphics settings, active preset detection, debug panel state, and fly-to requests
- `features/world-controls/components`: HUD, controls, toolbar, loading indicator, desktop debug panels, and the compact mobile tray
- `MapControlsContent.tsx` shows graphics presets only while debug mode is enabled, and renders them below the toggle list and above the usage instructions
- `world-controls` depends on shared client `lib/`, `types/`, and `components/`, but not on `world-view/lib`, so the scene/runtime feature stays isolated from UI-only concerns

## World-View Feature

- `features/world-view/components`: scene boundary, info panel, and debug parameter form
- `MapDebugParameters.tsx` is section-driven and reuses shared parameter-row chrome for sliders and resets, including performance controls for active and idle frame rate
- `features/world-view/hooks`: world data, player data, and WebSocket hooks
- `features/world-view/lib`: scene bootstrap, camera behavior, terrain loading, voxel scheduling, labels, markers, and feature types
- `features/world-view/workers`: `voxel-mesh.worker.ts` decodes mesh data off the main thread

## Shared Client Layers

- `components/OverlayPanel.tsx`: shared draggable/collapsible panel chrome used across desktop overlays
- `hooks/useCompactViewport.ts`: shared viewport-size hook used by app composition
- `lib/ui-theme.ts`: shared HUD design tokens used by app and feature UI
- `lib/world-view-debug.ts`: debug tuning defaults, parameter definitions, loading breakdown shape, and chunk stats contract
- `lib/world-view-graphics-presets.ts`: preset definitions and matching logic shared by controls and scene configuration
- `lib/world-view-storage.ts`: localStorage schema/versioning and persisted graphics settings helpers
- `lib/world-view-url-state.ts`: initial mode/camera parsing and share-location URL generation
- `types/world-view.ts`: shared mode, camera, layer visibility, share state, and fly-to contracts
- `utils/world-view-formatters.ts`: lightweight display helpers used by HUD and debug overlays

## Rendering Model

- React handles composition, data fetching, overlays, and socket subscription
- `WorldControlsProvider` keeps low-frequency controls in context so `App.tsx` stays small while high-frequency scene output remains outside shared context
- App composition follows a unidirectional shape consistent with Bulletproof React: shared client layers feed features, and `app/` is the layer where `world-controls` and `world-view` are composed together.
- Three.js handles the renderer, scene, camera, controls, meshes, labels, markers, and animation loop; the Parameters panel can cap that loop between `30` and `120` FPS, with an `Uncapped` stop shown to the right of `120` and stored internally as `0`
- Keyboard camera motion and `Q`/`E` orbiting are scaled by elapsed time, so their speed stays consistent even when the render loop is capped.
- When the scene is settled, no keyboard input is active, no work queues are pending, and the mouse is not hovering the canvas, the runtime can drop to a lower user-configured idle FPS after a short internal delay. Idle mode also uses a slower internal LOD polling interval.
- On startup, the client restores persisted graphics preset values, layer toggles, and custom parameter overrides from `localStorage`, then keeps those settings in sync as the user changes voxel rendering and parameter-panel values
- Biome labels remember separate terrain and voxel visibility choices, so switching modes restores the last toggle used in that mode
- On compact viewports the client replaces the floating corner panels with a bottom docked `Cubyz Map Viewer` tray. The tray is button-driven with collapsed and expanded states, keeps the share-location button in the top toolbar beside the terrain/voxel toggle, and groups controls, world info, and debug content into tabs so the map stays visible on smaller devices.
- `features/world-controls/components/MobileHudTray.tsx` is the compact HUD shell, and its tab content reuses the same control/debug/info components as the desktop overlays through `WorldViewHud.tsx`.
- Orbit controls enforce a small non-zero minimum camera distance so wheel zoom cannot get stuck at the target point
- A left-click, pen tap, or single-finger tap recenters the view on the hit terrain or voxel point and re-anchors the focus height to that surface, so zoom is local to the clicked location. Tapping a player marker reuses the existing player focus flow. The scene ignores inputs that move beyond a small threshold so drag-to-pan stays reliable.
- Right-drag remains orbit-only. On touch, pinch zoom and two-finger orbit explicitly suppress tap-to-focus, while tap-and-hold shows world coordinates without triggering focus on release. The coordinate HUD lingers briefly after touch release so it stays readable.
- `World3DView.tsx` is the boundary between those two layers
- `WorldViewPageContent.tsx` keeps `World3DView` eager so scene bootstrap stays deterministic, and lazy-loads the debug-parameters panel because it is optional UI
- Spawn focus keeps the current camera offset but re-anchors orbiting to visible terrain or voxel surface geometry at the spawn `x` and `y`, so zooming can continue down to terrain level instead of staying centered on the raw spawn elevation.
- When visible terrain or voxel geometry is not loaded yet, initial spawn focus falls back to a lifted spawn-relative height instead of the previous camera target so the camera does not start underground while surface data is still loading.
- Clicking or tapping a player re-anchors the focus to the player's position, while keeping the camera above visible terrain or voxel geometry when needed, so the zoom level resets around the selected player instead of inheriting the previous focus height.
- Player markers keep their current world-scaled size when underground. The name and underground note stay center-aligned, underground models drop to `0.6` opacity, and an extra second label line in muted gray shows a smaller `Below ground: Z -34`-style depth cue that updates with the player's live `z` position.

## Data Flow

### Initial Load

1. `main.tsx` creates the React Query client and renders `App`.
2. `WorldViewPageContent` loads world data, players, and the WebSocket connection.
3. `World3DView` initializes once world data is available.
4. Terrain and voxel resources load from camera position and the current mode.
5. Player marker model/texture assets load lazily once the player layer is visible or player data is present, and marker styling reads the server-provided `isActive` flag instead of recomputing stale state client-side.
6. If the `snale` assets fail to load, the viewer retries once and falls back to a visible marker sprite so players stay visible on the map.
7. Player marker models scale directly from each marker's Euclidean camera distance rather than from the orbit target distance, and the rendered model uses a calibrated grounded anchor so it sits on the terrain instead of floating above the saved player position or sinking into it.

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

1. `WorldControlsProvider` enables chunk index loading once the user enters voxel mode.
2. `useWorldData` fetches `/api/world/chunk-index`, which stays a cheap list of available voxel region columns.
3. The voxel runtime prioritizes detail from already loaded voxel mesh bounds and falls back to cheap region-aligned distance for unloaded regions, so nearby off-center structures can stay detailed without making chunk-index fetches expensive. Loaded-tile focus selection is still weighted by camera direction, and behind-camera bias adds a size-aware penalty so nearby rear chunks can fall back more aggressively during turns. In practice the rear multiplier is intentionally capped to a narrow range and the start threshold does most of the tuning.
4. `/api/voxels/:lod/:regionX/:regionY` returns compressed binary payloads with `max-age=0` and ETag revalidation.
5. The worker converts mesh buffers into typed arrays, bakes voxel face shading plus a wall depth gradient into base vertex colors, and keeps raw per-face AO separate from those base colors.
6. The main thread uploads the data to Three.js geometries within a frame budget and applies final seam-aware AO after voxel LOD visibility and parent-child fallback coverage are resolved. Loaded finer voxel tiles count as valid visible coverage even when their chunk-column mask is partial, so coarse parent quadrants do not incorrectly override visible fine geometry just because some child columns are empty. Top-face AO runs on `L1` and `L2`, while side faces currently rely on the baked face tint and depth cue only. The Parameters panel exposes a runtime AO intensity control for tuning the top-face effect.
7. The 3D runtime also publishes a lightweight loading breakdown every frame, and `WorldViewHud` uses it to drive the spinner even when debug stats are hidden.
8. Cursor hover prefers voxel meshes and falls back to the terrain underlay when enabled, converting the underlay hit back to the terrain's real world height.
9. When Debug and Chunk Borders are both enabled in voxel mode, the same hover HUD also shows the hovered voxel chunk LOD and region coordinates beside the world coordinates, for example `LOD 1 1536/6016`.
10. Transient hover suppression from held keys or pointer drags is reset when the browser window loses focus so OS-level app switching cannot leave the coordinate HUD stuck hidden after returning.

## Live Updates

1. `useWebSocket` connects to `/ws` and exposes the last server update time plus typed subscriptions.
2. The server broadcasts `players-updated`, `world-updated`, `surface-index-changed`, and `terrain-updates-batch`.
3. `usePlayers` keeps player activity fresh with a 30-second refetch interval and also reacts to `players-updated` events, but both sides now coalesce that work: the server batches player file churn behind a short quiet window and suppresses broadcasts when the semantic player state did not change, while the client debounces repeated player events and defers socket-driven player refreshes until the tab is visible again.
4. Terrain tile refreshes invalidate the changed tile plus its same-LOD neighbors because seam-safe terrain payloads depend on a 3x3 tile neighborhood. `surface-index-changed` takes the simpler clear-and-rebuild path for visible terrain so add/remove changes cannot leave stale neighbor-dependent meshes alive.
5. `World3DView` refreshes loaded scene data in place, and player updates reconcile marker objects in place so frequent `players-updated` events do not remount all nameplates.
6. Player markers use the `snale` entity model when the asset load succeeds, otherwise they render a fallback sprite marker with the player label.
7. Player model, marker, and name grayscale all derive from the server-owned `isActive` flag; the longer retention window controls when old players disappear from `/api/players` entirely.
8. Spawn and player marker labels use bundled `unscii-8` / `unscii-16` fonts via client `@font-face` definitions.

## Shared UI

- `OverlayPanel.tsx` provides draggable, collapsible, snapping overlay panels with shared styling.
- Drag listeners are only attached while a panel is actively being moved.
- A panel reset button only appears after the panel has actually moved away from its default anchored position.
- The panel header disables native touch panning so overlays can be dragged on touch devices.
- The client UI defaults to the bundled `unscii-16` font, while spawn and player marker labels keep their own `unscii-8`-first stack for compact map readability.
- Shared panels and controls use a retro HUD treatment: square corners, stronger borders, dark brown glass surfaces with light blur, offset shadows, and square slider/thumb controls.

## Design Principles

- keep scene/runtime code in `world-view`, control and HUD code in `world-controls`, and shared cross-feature code in `components/`, `hooks/`, `lib/`, `types/`, and `utils/`
- keep React responsible for composition, not per-frame 3D updates
- prefer direct imports over barrels
- compose features at the `app/` layer instead of importing feature internals across features
- use bounded queues and frame budgets for heavy terrain and voxel processing
- cap the shared render loop when lower idle CPU is preferable to max refresh-rate rendering
- prefer a lower idle frame rate once the scene is settled and the user is no longer interacting with the canvas
- avoid React re-renders for high-frequency cursor and frame-loop updates
- avoid publishing React state from the render loop unless the value actually changed

## Related Documentation

- `docs/architecture-overview.md` for shared system contracts
- `docs/server-specification.md` for the server-side routes, watcher flow, and payload generation this client consumes
