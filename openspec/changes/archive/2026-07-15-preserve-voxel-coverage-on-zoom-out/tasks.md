## 1. Regression Coverage

- [x] 1.1 Extend the voxel LOD test fixtures with loaded tiles and quadrant submeshes whose visibility can be asserted across selection passes.
- [x] 1.2 Add a failing multi-pass zoom-out test that keeps loaded fine descendants visible while an absent coarse parent is requested, then swaps visibility after the parent is added to `loadedVoxels`.
- [x] 1.3 Cover mixed-depth loaded descendants and assert fallback discovery does not schedule missing fine-detail requests.

## 2. Voxel LOD Handoff

- [x] 2.1 Add bounded loaded-descendant fallback discovery to `runVoxelLodSelection`, selecting the coarsest loaded non-overlapping tile in each desired ancestor subregion.
- [x] 2.2 Integrate descendant fallback masks into existing visibility and retention reconciliation without retaining obsolete fine fetch or worker demand.
- [x] 2.3 Confirm a scene-ready coarse ancestor replaces descendant fallback in one selection pass and existing unload grace/warm-cache behavior retires the fine tiles afterward.

## 3. Documentation And Verification

- [x] 3.1 Update `docs/client-specification.md` to document readiness-gated fine-to-coarse coverage alongside the existing coarse-to-fine quadrant fallback.
- [x] 3.2 Run `npm test && npm run check && npm run check:knip && npm run typecheck` and resolve any regressions.
