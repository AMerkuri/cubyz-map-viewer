## Why

Phase 1 (`voxel-3d-distance-lod`) fixes the altitude problem by adding Z to the distance calculation, which unlocks the screen-space ratio already baked into the LOD thresholds. However, a single reference surface Z is still too coarse for high-altitude views that contain actual foreground geometry near the camera: a chunk directly in front of the camera can occupy a large part of the screen while still being selected at a coarse LOD because the global surface reference is far below it. The current thresholds also assume a fixed FOV and viewport size. Screen-space LOD makes selection responsive to actual visible tile bounds, focus proximity, FOV, and viewport height so apparent size and foreground importance drive detail.

## What Changes

- Use actual loaded tile vertical bounds/local top-height data when available, so loaded foreground geometry is evaluated by distance to its real 3D bounds rather than only by the global `referenceSurfaceZ` fallback.
- Add projected screen-size selection for loaded voxel tiles: estimate each loaded tile's apparent pixel size from its world size, distance to its bounds, camera FOV, and viewport height, then allow a finer LOD when the tile occupies enough screen space.
- Bias LOD selection finer near the resolved voxel focus point/raycast hit so the area the user is looking at can refine even when altitude-based fallback distance would otherwise choose a coarse LOD.
- Keep an FOV-aware and viewport-aware distance modifier for unloaded candidates where projected loaded bounds are not yet available.
- Expose baseline FOV and baseline viewport height debug settings with sensible defaults (FOV 60°, balanced viewport baseline 2880px), so users can tune the behavior without code changes.
- **BREAKING**: None. The default balanced reference viewport is tuned to keep close ground-level LOD1 memory bounded while loaded-tile/projected-size refinement still selects finer LOD for visible foreground geometry or focus-adjacent areas that justify it on screen.

## Capabilities

### New Capabilities

_(None)_

### Modified Capabilities

- `voxel-lod-stability`: LOD selection now accounts for actual loaded tile bounds, projected screen size, focus proximity, camera FOV, and viewport size in addition to 3D distance. Foreground/focus tiles that occupy significant screen space can refine to finer LOD even when the global reference surface is far below the camera.

## Impact

- **Client behavior**: LOD selection adapts to actual visible tile bounds, focus area, viewport size, and FOV changes. High-altitude views can keep distant terrain coarse while refining loaded foreground chunks near the camera/focus point. On larger monitors, slightly finer LODs may be selected for the same camera distance; on smaller windows, slightly coarser LODs.
- **Affected code**:
  - `src/client/features/world-view/lib/voxel-lod.ts` — Apply loaded-tile bounds/projected-size and focus-biased LOD selection before falling back to scaled 3D reference-surface distance.
  - `src/client/features/world-view/lib/voxel-runtime.ts` — `updateVoxelLod` receives `screenSpaceDistanceScale` and passes it through.
  - `src/client/features/world-view/lib/lod-controller.ts` — `checkAndUpdateLod` receives and passes screen-space/focus inputs.
  - `src/client/features/world-view/components/World3DView.tsx` — Computes screen-space inputs from `camera.fov`, container dimensions, and resolved focus point, then passes them to `checkAndUpdateLodManaged`.
  - `src/client/lib/world-view-debug.ts` — New debug settings shown as LOD baseline FOV and LOD baseline viewport height.
  - `src/client/lib/world-view-graphics-presets.ts` — Add default values for new settings in all graphics presets.
- **No server changes**: All client-side.
- **No contract changes**: No API, WebSocket, or coordinate changes.
- **Documentation**: No doc updates needed — this is a client rendering detail.
- **Verification**: `npm run check && npm run check:knip && npm run typecheck`.
- **Depends on**: Phase 1 (`voxel-3d-distance-lod`) being implemented first, as this works on top of 3D distance.
