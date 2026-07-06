## Why

The viewer is now voxel-only from the user's perspective, but URL sharing, control state, persistence, docs, and scene wiring still carry terrain/voxel mode abstractions. Cleaning up those leftovers reduces confusion and makes the runtime model match the product behavior: voxel rendering with an optional terrain underlay.

## What Changes

- Remove redundant `mode=voxel` from generated share-location URLs and stop carrying mode through share-location state.
- Remove user/control-layer terrain-mode state that can no longer be reached, including startup mode plumbing and per-mode biome-label persistence.
- Rename terrain visibility state around the remaining behavior: optional terrain underlay for the voxel scene.
- Simplify UI gating that checks for voxel mode even though the viewer is always voxel-only.
- Keep terrain data and rendering internals needed for terrain underlay, biome labels, surface invalidation, and coordinate hover fallback.
- Update client/runtime documentation so it describes a voxel-only scene with optional terrain underlay, not separate terrain and voxel modes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `voxel-default-view`: Clarify that voxel is the only active user-facing view, generated share links do not include mode state, and optional terrain underlay remains the supported terrain-related display behavior.

## Impact

- Affects client URL/share state in `src/client/lib/world-view-url-state.ts`, `src/client/app/hooks/useWorldViewShareLocation.ts`, and scene share-state callbacks.
- Affects control state and persistence in `src/client/features/world-controls/WorldControlsProvider.tsx`, `src/client/lib/world-view-storage.ts`, and related control/debug components.
- Affects scene prop/types and selected runtime helpers in `src/client/features/world-view/`, while preserving terrain-underlay and terrain-data dependencies.
- Requires `docs/client-specification.md` updates for runtime flow and `docs/architecture-overview.md` cleanup for the high-level rendering description.
- Does not change server APIs, WebSocket event names, voxel payload formats, coordinate conventions, or Cubyz save contracts.
