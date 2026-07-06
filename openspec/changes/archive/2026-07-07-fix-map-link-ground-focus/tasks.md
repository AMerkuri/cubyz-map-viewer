## 1. URL State Contract

- [x] 1.1 Extend the client camera URL state model to represent whether a link is exact-focus or map-compatible.
- [x] 1.2 Update viewer share URL generation to include the exact-focus marker for newly copied links.
- [x] 1.3 Keep URLs without the exact-focus marker valid and classify them as map-compatible links.

## 2. Camera Focus Resolution

- [x] 2.1 Refactor initial camera application so exact-focus links preserve the supplied target coordinates exactly.
- [x] 2.2 Add surface-aware startup targeting for map-compatible links while preserving requested `zoom`, `theta`, and `phi`.
- [x] 2.3 Reuse or adapt existing visible-surface raycast behavior so voxel geometry is preferred when available and terrain is used as fallback.
- [x] 2.4 Add deferred retargeting when relevant terrain or voxel geometry is not available at initial camera application.
- [x] 2.5 Ensure corrected map-compatible targets mark camera-dependent terrain, label, biome, voxel, or sign state dirty as needed.

## 3. Documentation

- [x] 3.1 Update `docs/client-specification.md` with camera URL focus-mode behavior and map-compatible fallback semantics.
- [x] 3.2 Update `docs/architecture-overview.md` if the camera URL contract is documented as shared runtime behavior.

## 4. Verification

- [x] 4.1 Manually verify the repro URL focuses ground-level navigation near `x=7649,y=4190` instead of orbiting an air target.
- [x] 4.2 Manually verify a newly copied viewer share link restores exact target, zoom, theta, and phi.
- [x] 4.3 Run `npm run check && npm run check:knip && npm run typecheck`.
- [x] 4.4 Run `npm run build` if implementation changes exported TypeScript camera URL types or other TypeScript boundaries.
