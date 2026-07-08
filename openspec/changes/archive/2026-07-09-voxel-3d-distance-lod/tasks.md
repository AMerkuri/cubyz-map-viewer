## 1. Core 3D Distance Calculation

- [x] 1.1 Add `referenceSurfaceZ: number` parameter to `getTileEffectiveDist` in `voxel-lod.ts`. Compute `dz = Math.max(0, cameraPosition.z - referenceSurfaceZ)` and return `Math.hypot(dx, dy, dz)` instead of `Math.hypot(dx, dy)`.
- [x] 1.2 Add `referenceSurfaceZ: number` parameter to `getTileLodSelectionDist` in `voxel-lod.ts`, passing it through to `getTileEffectiveDist`.
- [x] 1.3 Update all internal closures in `runVoxelLodSelection` (`getEffectiveDist`, `getLodSelectionDist`) to capture and use `referenceSurfaceZ` from the new function parameter.
- [x] 1.4 Add `referenceSurfaceZ: number` to `runVoxelLodSelection`'s args type and destructure it.

## 2. Thread `referenceSurfaceZ` Through Call Chain

- [x] 2.1 Add `referenceSurfaceZ: number` to `updateVoxelLod` args type in `voxel-runtime.ts` and pass it through to `runVoxelLodSelection`.
- [x] 2.2 Add `referenceSurfaceZ: number` to `checkAndUpdateLod` args type in `lod-controller.ts` and pass it through to `updateVoxelLod`.

## 3. Compute `referenceSurfaceZ` at Call Site

- [x] 3.1 Add a helper function to compute `referenceSurfaceZ` from loaded voxel tiles near the camera position (scan `loadedVoxels` for tiles whose horizontal bounds contain the camera X/Y, prefer the local chunk top-height sample with tile `maxZ` as fallback), with fallback to `spawn[2]` when no tiles are found.
- [x] 3.2 Wire the helper into `checkAndUpdateLOD` in `World3DView.tsx`, passing the computed `referenceSurfaceZ` to `checkAndUpdateLodManaged`.

## 4. Fix Focus Initialization

- [x] 4.1 Add `referenceSurfaceZ: number` parameter to `resolveVoxelLodFocus` in `voxel-focus.ts`.
- [x] 4.2 In `resolveVoxelLodFocus`, when no sample is found (no loaded tiles, no raycast hit, no sticky state), initialize `zoomDist` from `Math.max(0, camera.position.z - referenceSurfaceZ)` instead of `fallbackZoomDist` (orbit distance). Keep `fallbackZoomDist` as a secondary fallback when `referenceSurfaceZ` is not finite.
- [x] 4.3 Wire `referenceSurfaceZ` into the `resolveVoxelLodFocus` call in `checkAndUpdateLOD` in `World3DView.tsx` (can reuse the value from task 3.2).

## 5. Verification

- [x] 5.1 Run `npm run check && npm run check:knip && npm run typecheck`.
- [x] 5.2 Manually verify at `?x=155&y=5718&z=3500&zoom=24&theta=-90&phi=17&focus=exact` that Focus LOD starts at a coarser level (not LOD1) and LOD1 tile count drops significantly with memory under ~300MB.
- [x] 5.3 Manually verify at ground level (e.g., `?x=0&y=0&z=50&zoom=100&theta=-90&phi=45&focus=exact`) that LOD selection is unchanged from prior behavior.
