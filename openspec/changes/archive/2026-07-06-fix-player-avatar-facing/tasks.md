## 1. Player Marker Orientation

- [x] 1.1 Update `src/client/features/world-view/lib/markers.ts` so `updatePlayerMarkerObject` maps player yaw to marker Z rotation without the global 180 degree offset.
- [x] 1.2 Update the nearby orientation comment to describe the corrected Cubyz yaw sign conversion.
- [x] 1.3 Confirm marker creation and marker refresh both use the corrected path through `updatePlayerMarkerObject`.

## 2. Verification

- [x] 2.1 Run `npm run check`.
- [x] 2.2 Run `npm run check:knip`.
- [x] 2.3 Run `npm run typecheck`.
- [x] 2.4 Manually verify, when a suitable save is available, that a player facing a known cardinal direction renders facing that same direction rather than the opposite direction.
