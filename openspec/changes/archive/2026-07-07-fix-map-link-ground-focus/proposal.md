## Why

Map-generated deep links can restore the 3D camera to an air point instead of the visible ground, leaving the user unable to zoom meaningfully to ground level. This is visible with links such as `?x=7649&y=4190&z=64&zoom=3&theta=121&phi=22`, where the terrain surface is about 34 blocks below the URL target.

## What Changes

- Add client behavior that resolves map/deep-link startup focus to a usable terrain or voxel surface when the provided target altitude does not match the visible ground.
- Preserve exact camera sharing semantics where appropriate, so links copied from the 3D viewer continue to restore the same camera target and orientation.
- Keep spawn/player focus behavior consistent with the corrected surface-level navigation model.
- Avoid server API or persistent data changes unless implementation discovers that existing terrain data is insufficient.

## Capabilities

### New Capabilities
- `camera-deep-link-focus`: Defines how URL-provided camera state should focus the 3D scene, including map-origin links that need surface-level targeting and viewer-origin links that should preserve exact camera state.

### Modified Capabilities

## Impact

- Affects client camera initialization and possibly runtime fly-to helpers under `src/client/features/world-view/lib/camera.ts`, `src/client/features/world-view/lib/view-hooks.ts`, and `src/client/features/world-view/lib/scene-runtime.ts`.
- May affect URL state parsing/creation in `src/client/lib/world-view-url-state.ts` if the implementation needs to distinguish viewer share links from external map links.
- May require client documentation updates if URL semantics or camera restoration behavior changes.
- No expected server, dependency, worker, or build pipeline changes.
