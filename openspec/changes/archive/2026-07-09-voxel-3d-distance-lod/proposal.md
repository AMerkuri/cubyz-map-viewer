## Why

When the camera is high above the terrain (e.g., z=3500 with terrain at z=35), the voxel LOD system still loads LOD1 chunks directly below the camera. This happens because tile effective distance is computed using only horizontal (X, Y) distance — the Z component is ignored. A tile directly below the camera at z=3500 has a horizontal distance of 0, so it gets LOD1 selected even though the 3D distance is ~3465 blocks. This causes LOD1 chunks alone to consume 2+ GB of memory, tanking FPS to ~15, with no visual benefit since LOD1 detail is invisible at that altitude.

## What Changes

- Add a vertical (Z) component to `getTileEffectiveDist` so that tile effective distance is computed in 3D, not just 2D horizontally.
- Introduce a `referenceSurfaceZ` value into `runVoxelLodSelection`, computed from nearby loaded voxel tile local top-height values with a fallback to `spawn[2]`. This provides the terrain surface Z for the vertical distance calculation when tile Z bounds are not yet available (e.g., for unloaded root entries).
- Thread `referenceSurfaceZ` through all call sites of `getTileEffectiveDist` and `getTileLodSelectionDist` in `voxel-lod.ts`: tile selection, unload loop, and stale loading cleanup.
- Fix focus LOD initialization in `voxel-focus.ts`: when no tiles are loaded and no raycast hit is available, initialize `zoomDist` from `camera.z - referenceSurfaceZ` instead of the orbit zoom distance (which can be as low as 24, incorrectly selecting LOD1).
- The existing LOD distance thresholds (`voxelLod1MaxDist`, `1200`, `2400`, `4800`, `9600`, `Infinity`) already encode a consistent screen-space ratio (tile world size / maxDist ≈ 0.213 for all LODs). Adding 3D distance unlocks this existing screen-space behavior without threshold changes.

## Capabilities

### New Capabilities

_(None)_

### Modified Capabilities

- `voxel-lod-stability`: The "LOD selection considers vertical cost" requirement is being implemented — tile effective distance now includes the Z axis, and focus initialization uses 3D distance when no tiles are loaded. The convergence and stability expectations still apply but the selection criteria now account for altitude.

## Impact

- **Client behavior**: Tiles below a high-altitude camera will be selected at coarser LODs (e.g., LOD8 instead of LOD1 at z=3500), dramatically reducing memory and improving FPS. The effect is proportional to camera altitude — at ground level, `dz ≈ 0` and behavior is unchanged.
- **Affected code**:
  - `src/client/features/world-view/lib/voxel-lod.ts` — `getTileEffectiveDist`, `getTileLodSelectionDist`, `runVoxelLodSelection` (new `referenceSurfaceZ` parameter threaded through all internal call sites).
  - `src/client/features/world-view/lib/voxel-focus.ts` — Focus initialization fallback when no tiles/raycasts are available.
  - `src/client/features/world-view/lib/voxel-runtime.ts` — `updateVoxelLod` function signature (passes `referenceSurfaceZ` to `runVoxelLodSelection`).
  - `src/client/features/world-view/components/World3DView.tsx` — Wires `spawn` Z and nearby loaded tile Z into the `updateVoxelLod` call.
- **No server changes**: All changes are client-side LOD selection logic.
- **No contract changes**: Coordinate conventions, WebSocket events, and API endpoints are unchanged.
- **Documentation**: Update `docs/client-specification.md` if it mentions LOD distance calculation; otherwise no doc changes needed.
- **Verification**: `npm run check && npm run check:knip && npm run typecheck` (no build path changes).
