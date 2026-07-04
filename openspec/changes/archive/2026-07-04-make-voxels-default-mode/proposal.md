## Why

The viewer currently starts in terrain mode unless the URL explicitly requests voxel mode, even though voxel mode is now the primary experience. Keeping a terrain/voxel tab selector exposes an obsolete choice and delays voxel-specific data loading until the user switches modes.

## What Changes

- Make voxel mode the default and only user-reachable world view mode.
- Remove the terrain/voxel UI selector from the HUD toolbar.
- Treat existing or missing mode URL state as voxel mode so old links do not open terrain mode.
- Enable voxel chunk-index loading during initial page load instead of waiting for a mode switch.
- Keep voxel-mode controls available, including optional terrain underlay behavior unless separately removed.
- Update client documentation to reflect the voxel-first runtime flow.

## Capabilities

### New Capabilities

- `voxel-default-view`: Client behavior for starting and operating the world viewer in voxel mode without exposing a terrain-mode selector.

### Modified Capabilities

None.

## Impact

- Affects client UI composition in `src/client/app/components/WorldViewHud.tsx` and `src/client/features/world-controls/components/TopRightToolbar.tsx`.
- Affects control initialization and persisted/URL mode handling in `src/client/features/world-controls/WorldControlsProvider.tsx` and `src/client/lib/world-view-url-state.ts`.
- Affects initial data loading through `useWorldData(state.chunkIndexEnabled)` because chunk-index loading should be active immediately.
- Affects share-location behavior if mode remains part of generated URLs.
- Requires `docs/client-specification.md` updates because the current runtime documentation says chunk-index loading is disabled until voxel mode is entered.
