## 1. URL And Share State

- [x] 1.1 Remove world-view mode from `ShareLocationState` and scene share-state callbacks while preserving camera position, zoom, theta, and phi.
- [x] 1.2 Stop generating `mode=voxel` in copied location URLs and keep copied URLs camera-only.
- [x] 1.3 Remove startup mode parsing/plumbing from `WorldViewPage` and keep legacy `mode` query parameters harmlessly ignored.

## 2. Control State And Persistence

- [x] 2.1 Remove user/control-layer `WorldViewMode` state, `initialMode`, and `state.view` from `WorldControlsProvider` and related types.
- [x] 2.2 Replace terrain-mode layer fields with voxel-scene underlay state, including a clearer terrain-underlay name in `LayerVisibility`.
- [x] 2.3 Simplify persisted graphics settings by removing per-mode biome label state and obsolete standalone terrain visibility fields, bumping storage version as needed.
- [x] 2.4 Update map controls, debug parameter components, and debug stats so voxel controls remain visible without mode gating and no stale "Mode" stat is shown.

## 3. Scene Runtime Wiring

- [x] 3.1 Remove mode props from `WorldViewScene`, `World3DView`, and shared world-view types where voxel mode is now implicit.
- [x] 3.2 Rename scene/runtime inputs from standalone terrain visibility to terrain-underlay visibility where they control voxel-scene underlay behavior.
- [x] 3.3 Simplify runtime helpers that only choose between terrain mode and voxel mode, while preserving terrain underlay loading, terrain invalidation, biome labels, and coordinate hover fallback.
- [x] 3.4 Confirm voxel rendering remains active when terrain underlay is enabled or disabled.

## 4. Documentation

- [x] 4.1 Update `docs/client-specification.md` to describe voxel-only initialization, camera-only share URLs, and terrain underlay as an optional layer.
- [x] 4.2 Update `docs/architecture-overview.md` so the high-level rendering description no longer refers to separate terrain and voxel modes.

## 5. Verification

- [x] 5.1 Run `npm run check`.
- [x] 5.2 Run `npm run check:knip`.
- [x] 5.3 Run `npm run typecheck`.
