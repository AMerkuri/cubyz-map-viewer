## 1. Layer Visibility Defaults

- [x] 1.1 In `src/client/lib/world-view-storage.ts`, change the `readBoolean` fallback for `biomeLabels` from `false` to `true` in `sanitizeLayerVisibility`
- [x] 1.2 In `src/client/lib/world-view-storage.ts`, change the `readBoolean` fallback for `showTerrainUnderlay` from `false` to `true` in `sanitizeLayerVisibility`
- [x] 1.3 In `src/client/features/world-controls/WorldControlsProvider.tsx`, change the `?? false` fallback for `biomeLabels` to `?? true` in `createInitialLayerVisibility`
- [x] 1.4 In `src/client/features/world-controls/WorldControlsProvider.tsx`, change the `?? false` fallback for `showTerrainUnderlay` to `?? true` in `createInitialLayerVisibility`

## 2. Default Camera Zoom

- [x] 2.1 In `src/client/features/world-view/lib/constants.ts`, change `INITIAL_CAMERA_ZOOM` from `1500` to `500`

## 3. Verification

- [x] 3.1 Run `npm run check && npm run check:knip && npm run typecheck`
