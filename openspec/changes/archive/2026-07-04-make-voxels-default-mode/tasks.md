## 1. Voxel-Only Initialization

- [x] 1.1 Update initial mode parsing so missing, terrain, voxel, or invalid URL mode values all initialize as voxel mode.
- [x] 1.2 Ensure `WorldControlsProvider` starts with voxel mode and enables chunk-index loading immediately.
- [x] 1.3 Review share-location URL creation and keep mode handling coherent for voxel-only behavior.

## 2. HUD Selector Removal

- [x] 2.1 Remove the terrain/voxel selector from the top-right toolbar.
- [x] 2.2 Remove now-unused mode-switch props, callbacks, imports, and component exports if they are no longer referenced.
- [x] 2.3 Confirm desktop and compact HUDs still render copy-location and existing controls correctly without the selector.

## 3. Voxel Controls And Runtime Flow

- [x] 3.1 Confirm voxel-specific controls remain visible under their existing voxel-mode conditions.
- [x] 3.2 Confirm the scene receives voxel mode on startup and voxel loading can use the initial chunk index.
- [x] 3.3 Confirm WebSocket refresh handling can refresh chunk index data after startup when voxel regions change.

## 4. Documentation And Verification

- [x] 4.1 Update `docs/client-specification.md` to describe voxel-default startup and immediate chunk-index loading.
- [x] 4.2 Run `npm run check`.
- [x] 4.3 Run `npm run check:knip`.
- [x] 4.4 Run `npm run typecheck`.
