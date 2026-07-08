## Why

New users land on an empty-looking voxel scene with biome labels and terrain underlay off, and the camera positioned far away (zoom 1500). The information density at first load is low, and viewers must manually enable several layers and zoom in before the scene becomes useful. Making biome labels and terrain underlay default to ON and lowering the initial camera zoom to 500 gives first-time visitors a more informative, closer view of the world immediately.

## What Changes

- Default `biomeLabels` visibility changes from `false` to `true` for new users (no stored settings).
- Default `showTerrainUnderlay` visibility changes from `false` to `true` for new users (no stored settings).
- `INITIAL_CAMERA_ZOOM` constant changes from `1500` to `500`, affecting the default camera distance on fresh page loads without URL camera parameters.
- Existing users with persisted settings are unaffected — their stored boolean preferences and the zoom they'd get from share links are preserved as-is.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `voxel-default-view`: The default view initialization now enables biome labels and terrain underlay by default for new users, and the default camera zoom distance when no URL camera state is present is lowered from 1500 to 500.

## Impact

- **Client behavior**: Default initial layer visibility and default initial camera zoom for first-time / no-stored-settings users.
- **Affected files**: `src/client/features/world-controls/WorldControlsProvider.tsx` (default fallbacks in `createInitialLayerVisibility`), `src/client/lib/world-view-storage.ts` (sanitizer fallbacks in `sanitizeLayerVisibility`), `src/client/features/world-view/lib/constants.ts` (`INITIAL_CAMERA_ZOOM`).
- **No API changes, no server changes, no shared contract changes.**
- **No documentation updates required** — this is a client-side default-values change with no contract impact.
- **Migration**: No storage version bump. Existing users keep their stored settings. Only users without stored settings (new visitors or those who cleared localStorage) see the new defaults.
