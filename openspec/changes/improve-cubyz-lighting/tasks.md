## 1. Baseline Review

- [x] 1.1 Trace the current emitted-light path from Cubyz `.emittedLight` parsing through voxel payload encoding, worker decoding, mesh color generation, and `BlockLightRuntimeManager` accents.
- [x] 1.2 Capture the current quality settings, budgets, and night atmosphere values that produce the comparison-scene behavior.
- [x] 1.3 Decide whether the first implementation uses same-tile emitters only or includes neighboring loaded emitters for mesh-local contribution.

## 2. Mesh-Local Emitted-Light Contribution

- [x] 2.1 Add a bounded emitted-light contribution path to voxel mesh color generation so nearby emitter RGB affects visible voxel face or vertex colors.
- [x] 2.2 Gate mesh-local emitted-light contribution by existing atmosphere and block-light quality settings, preserving quality `0` fallback behavior.
- [x] 2.3 Tune falloff, intensity, clamping, and color blending so local light remains Cubyz-like and does not wash block identity to white.
- [x] 2.4 Ensure multiple nearby emitters combine deterministically without depending on an unbounded Three.js point-light count.
- [x] 2.5 Preserve transparent voxel readability or add transparent-specific light contribution handling if the shared path makes transparent blocks too bright or muddy.

## 3. Runtime Accent Rebalance

- [x] 3.1 Rebalance `BlockLightRuntimeManager` so point lights and glow sprites are secondary accents rather than the primary visible lighting model.
- [x] 3.2 Make emitter-over-budget degradation limit optional runtime accents first while preserving mesh-local illumination for built voxel geometry.
- [x] 3.3 Update block-light stats if needed so decoded emitters, active accent emitters, budget, and degraded state remain understandable.

## 4. Night Atmosphere Tuning

- [x] 4.1 Tune low-light ambient, hemisphere, sun, fill, sky, and fog values to preserve a dark Cubyz-like ambient/skylight floor.
- [ ] 4.2 Verify nighttime terrain, vegetation, voxel silhouettes, HUD labels, and local emitter contrast remain readable in the comparison scene.
- [ ] 4.3 Confirm daytime and dusk atmosphere states remain visually acceptable after the low-light tuning.

## 5. Cache, Contracts, And Documentation

- [x] 5.1 Determine whether implementation changed voxel payload semantics or persisted mesh interpretation; if yes, bump the relevant cache/version signature. (No bump needed: server payload and signatures unchanged; client has no persisted mesh cache.)
- [x] 5.2 Update `docs/client-specification.md` for the new mesh-local emitted-light rendering behavior and night atmosphere baseline.
- [x] 5.3 Update `docs/server-specification.md` and `docs/architecture-overview.md` if any server payload, cache, or shared binary contract behavior changes. (No server payload, cache, or shared contract behavior changed.)
- [x] 5.4 Keep OpenSpec expectations aligned with any implementation decisions that narrow or expand the proposal scope.

## 6. Verification

- [x] 6.1 Run `npm run check`.
- [x] 6.2 Run `npm run check:knip`.
- [x] 6.3 Run `npm run typecheck`.
- [x] 6.4 Run `npm run build` because this change touches voxel worker/build-boundary behavior.
- [ ] 6.5 Manually compare the known night scene against Cubyz and verify the viewer no longer presents emitted blocks as isolated bright blobs over a crushed-black scene.
