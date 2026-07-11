## 1. Confirm root cause

- [x] 1.1 In `voxel-mesh.worker.ts`, confirm insertion bounds use raw `record.radius` (`buildEmitterLightGrid` extent scan) while falloff uses padded `grid.radius[i]`, documenting the asymmetry
- [x] 1.2 Reproduce the seam cutoff in a nighttime scene and confirm it disappears when the `haloEmitters` debug toggle is unchanged but the emitter grid is padded (manual/inspection check)

## 2. Align insertion radius with falloff radius

- [x] 2.1 Compute each emitter's padded influence radius (raw radius + quantization padding, clamped to `EMITTER_MAX_RADIUS`) once, and reuse it for both the bounding-box extent scan and the per-cell insertion loop in `buildEmitterLightGrid`
- [x] 2.2 Ensure `grid.radius[i]` (used by `accumulateEmitterLight`) equals the same padded radius so insertion coverage is never smaller than falloff reach

## 3. Restore boundary slack

- [x] 3.1 Expand each emitter's inserted cell range by one cell on every side to absorb `floor` divergence at cell edges
- [x] 3.2 Update the dense-grid bounding box (`minCellX..maxCellX` etc.) and `denseCellIndex` extent so the added margin cells are in bounds and not dropped
- [x] 3.3 Keep the sparse fallback (`EMITTER_DENSE_GRID_MAX_CELLS`) and broad-emitter path (`EMITTER_MAX_INDEX_CELLS`) correct under the new bounds

## 4. Verify candidate selection integrity

- [x] 4.1 Filter out-of-radius and face-blocked candidates before bounded nearest selection so a reachable seam/halo emitter is not excluded by insertion slack
- [x] 4.2 Expand `quadCanReceiveEmitterLight` culling by the receiver probe margin so no quad that should receive light is culled

## 5. Validate lighting continuity

- [x] 5.1 Verify emitted light spreads continuously across chunk/region seams at LOD 1 with no straight-line cutoff
- [x] 5.2 Verify continuity across grid-cell boundaries within a single region at LOD 1
- [x] 5.3 Spot-check LOD 2, 4, 8, 16, 32 seam scenes for brightness continuity and confirm coarse-LOD brightness/footprint is not regressed
- [x] 5.4 Confirm the `haloEmitters` diagnostic toggle and emissive-bake bypass still behave correctly and default presentation is restored when cleared

## 6. Performance check

- [x] 6.1 Compare emissive-phase metrics (`gridBuildMs`, `bakeMs`, `candidateVisits`) before/after to confirm bake cost stays bounded and grid-build cost is acceptable

## 7. Verification and docs

- [x] 7.1 Run `npm run check && npm run check:knip && npm run typecheck`
- [x] 7.2 Run `npm run build` (voxel worker boundary changed)
- [x] 7.3 If `docs/client-specification.md` documents the bake candidate/grid model, update it to describe padded insertion coverage and cross-seam continuity

## 8. Restore Neighbor Probe Fallback

- [x] 8.1 Probe the receiver grid cell plus its 26 neighbors with stamped typed-array de-duplication
- [x] 8.2 Revalidate the reported `640/5376` to `768/5376` LOD 1 seam and update the visual validation tasks
