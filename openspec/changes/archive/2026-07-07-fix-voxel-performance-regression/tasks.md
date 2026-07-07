## 1. Baseline And Diagnostics

- [x] 1.1 Add voxel generation metrics that separate greedy cube quads, model/semantic quads, transparent quads, total quads, raw payload bytes, and cache tier for each generated region.
- [x] 1.2 Propagate relevant voxel metrics through `VoxelMeshService` and the voxel response benchmark path without bypassing the existing service route.
- [x] 1.3 Extend client debug stats to distinguish loaded geometry bytes, retained CPU metadata bytes, warm-cache bytes, queued worker-output bytes, and memory by LOD without double-counting geometry attributes.
- [x] 1.4 Capture before/after baseline numbers at `/?x=805&y=5456&z=51&zoom=100&theta=89&phi=40` after voxel loading reaches idle.

## 2. Voxel Payload Optimization

- [x] 2.1 Design and implement a cache-versioned voxel binary payload update that keeps compact integer coordinates for ordinary greedy cube geometry and preserves fractional coordinates for model/semantic geometry.
- [x] 2.2 Update the browser voxel worker decoder to parse the optimized payload format, validate truncation errors, and produce the same world-space geometry for cube and fractional model quads.
- [x] 2.3 Ensure persisted voxel mesh caches are invalidated when the payload format or shape encoding semantics change.
- [x] 2.4 Verify hover palette identity and transparent render-kind separation still decode correctly with the optimized payload.

## 3. Model And Transparent Geometry Budgeting

- [x] 3.1 Add budget-aware accounting for LOD1 model/semantic block geometry during voxel generation.
- [x] 3.2 Implement documented fallback or reduction behavior for excessive model/semantic geometry while preserving normal model rendering in non-dense regions.
- [x] 3.3 Keep transparent voxel faces rendered separately from opaque faces while avoiding avoidable duplicate retained arrays.
- [x] 3.4 Verify dense transparent/model regions report their cost in debug/service metrics.

## 4. Client Retention And LOD Stability

- [x] 4.1 Reduce duplicate retained CPU-side voxel arrays where they are not required for AO updates, hover identity, stale refresh, or rendering correctness.
- [x] 4.2 Preserve cursor hover block ID for optimized cube geometry, model-backed geometry, and transparent geometry.
- [x] 4.3 Review voxel LOD distance and retention behavior at stable camera poses, including vertical terrain cases, without reintroducing stationary loaded-count oscillation.
- [x] 4.4 Confirm warm-cache eviction and stale voxel refresh still dispose or replace optimized voxel tile resources correctly.

## 5. Documentation And Verification

- [x] 5.1 Update `docs/architecture-overview.md` for any voxel payload, metric, cache-version, or client/server contract changes.
- [x] 5.2 Update `docs/client-specification.md` and/or `docs/server-specification.md` for affected voxel debug stats, worker payload decoding, or route payload behavior.
- [x] 5.3 Run `npm run check && npm run check:knip && npm run typecheck`.
- [x] 5.4 Run `npm run build` because the change touches worker wiring, route payloads, and TypeScript boundaries.
- [x] 5.5 Re-test the reported regression URL and compare idle FPS, loaded counts by LOD, estimated memory by LOD, worker input bytes, decoded bytes, and decode time against the captured baseline.
