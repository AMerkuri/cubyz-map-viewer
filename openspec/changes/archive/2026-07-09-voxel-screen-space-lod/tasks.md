## 1. Debug Settings

- [x] 1.1 Add `lodReferenceFov: number` and `lodReferenceViewportHeight: number` to `MapDebugSettings` in `world-view-debug.ts` with defaults `60` and `2880`.
- [x] 1.2 Add parameter definitions for both settings to `MAP_DEBUG_PARAMETER_DEFINITIONS` in `world-view-debug.ts` (section: "LOD").
- [x] 1.3 Add `lodReferenceFov` and `lodReferenceViewportHeight` to all 5 graphics presets in `world-view-graphics-presets.ts` (extreme: 75/720, quality: 62/2400, balanced: 60/2880, performance: 50/3600, ultra-performance: 40/4320).
- [x] 1.4 Add both settings to `WorldControlsProvider` state, persistence, and preset application in `WorldControlsProvider.tsx`.

## 2. Distance Scale Computation

- [x] 2.1 Add a helper function `computeScreenSpaceDistanceScale(fov: number, viewportHeight: number, referenceFov: number, referenceViewportHeight: number): number` in `lod-utils.ts` that returns `(Math.tan(fov/2) / Math.tan(refFov/2)) * (referenceViewportHeight / viewportHeight)`.
- [x] 2.2 Handle edge cases: if `fov` or `referenceFov` is not finite or <= 0, return 1.0. If `viewportHeight` or `referenceViewportHeight` is not finite or <= 0, return 1.0.

## 3. Loaded Bounds and Focus Inputs

- [x] 3.1 Add helpers in `voxel-lod.ts` to compute distance to loaded voxel tile bounds using `regionX`, `regionY`, `regionWorldSize(lod)`, `minZ/maxZ`, and local `chunkTopHeights` when useful.
- [x] 3.2 Add helper in `voxel-lod.ts` to estimate projected tile size in pixels from tile world size, loaded-bounds distance, camera FOV, and viewport height.
- [x] 3.3 Add `screenSpaceDistanceScale`, `cameraFov`, `viewportHeight`, and `focusPoint` parameters to `runVoxelLodSelection` in `voxel-lod.ts`.
- [x] 3.4 In `runVoxelLodSelection`, use loaded tile bounds/projected size and focus proximity to allow finer desired LOD for loaded foreground/focus tiles before falling back to scaled reference-surface effective distance.
- [x] 3.5 Keep unload and stale-loading cleanup consistent with the selected loaded-bounds/focus-aware distance so focus-adjacent refined tiles are not immediately unloaded.
- [x] 3.6 Add `screenSpaceDistanceScale`, `cameraFov`, `viewportHeight`, and `focusPoint` to `updateVoxelLod` args in `voxel-runtime.ts` and pass through to `runVoxelLodSelection`.
- [x] 3.7 Add `screenSpaceDistanceScale`, `cameraFov`, `viewportHeight`, and `focusPoint` to `checkAndUpdateLod` args in `lod-controller.ts` and pass through to `updateVoxelLod`.

## 4. Wire at Call Site

- [x] 4.1 In `World3DView.tsx` `checkAndUpdateLOD`, compute `screenSpaceDistanceScale` from `camera.fov`, container client height, and debug settings (`lodReferenceFov`, `lodReferenceViewportHeight`).
- [x] 4.2 Pass camera FOV, viewport height, `screenSpaceDistanceScale`, and the resolved voxel focus point to `checkAndUpdateLodManaged`/`updateVoxelLodManaged`.

## 5. Verification

- [x] 5.1 Run `npm run check && npm run check:knip && npm run typecheck`.
- [x] 5.2 Manually verify at a ground-level URL that LOD selection is unchanged (scale ≈ 1.0 at default settings).
- [x] 5.3 Manually verify at `?x=155&y=5718&z=3504&zoom=24&theta=-90&phi=17&focus=exact` that visible foreground geometry/focus area can refine to LOD1 while distant terrain remains coarser.
- [x] 5.4 Manually verify that changing `lodReferenceViewportHeight` in the debug panel affects LOD selection (lower value → finer LOD, higher value → coarser LOD).
- [x] 5.5 Manually verify that resizing the browser window affects LOD selection (smaller window → coarser LOD).
