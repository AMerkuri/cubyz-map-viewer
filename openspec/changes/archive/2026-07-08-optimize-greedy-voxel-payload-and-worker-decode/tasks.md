## 1. Measurement Baseline

- [x] 1.1 Capture current idle regression URL metrics without using FPS as the pass/fail metric: loaded counts by LOD, memory by LOD, worker input bytes, decoded bytes, decode time, raw payload bytes, and queued worker-output bytes.
- [x] 1.2 Use `/api/voxels/metrics` to sample representative nearby LOD1 and coarser regions, recording quad count, greedy cube quads, model quads, dropped model quads, transparent quads, raw payload bytes, and compressed variant sizes.
- [x] 1.3 Identify at least one cube-heavy region and one model-budget-heavy region for before/after payload and decode comparison.

## 2. Parametric Greedy Payload

- [x] 2.1 Design the cache-versioned binary layout for parametric greedy records plus fractional model records, avoiding avoidable per-quad source/position-kind overhead.
- [x] 2.2 Update server greedy quad representation so axis-aligned merged cube faces carry face direction, plane, `u`, `v`, `du`, and `dv` fields before binary encoding.
- [x] 2.3 Update `encodeBinaryQuads` or replacement helpers to encode greedy cube quads parametrically and model/semantic quads with fractional coordinates.
- [x] 2.4 Preserve per-record color, AO, winding, palette index, render kind, and model/greedy metrics in the optimized payload.
- [x] 2.5 Bump `VOXEL_GENERATOR_CACHE_VERSION` so persisted voxel mesh caches generated with the previous binary layout are invalidated.

## 3. Worker Decode And Output Construction

- [x] 3.1 Update the browser voxel worker to validate and decode the optimized mixed payload format with explicit truncation errors.
- [x] 3.2 Reconstruct parametric greedy records to the same world-space vertices, winding, normals, AO corner order, and chunk-top-height behavior as the current explicit-vertex path.
- [x] 3.3 Preserve fractional model/semantic decode for authored model coordinates, including out-of-block coordinates.
- [x] 3.4 Refactor worker decoding to avoid full-region intermediate arrays where practical, using a counting pass and direct writes into opaque/transparent quadrant output arrays.
- [x] 3.5 Preserve triangle palette metadata for opaque, transparent, greedy, and model-backed faces so cursor hover identity still resolves block IDs.

## 4. Diagnostics And Budget Review

- [x] 4.1 Extend service and benchmark metrics to expose optimized payload record mix, raw payload bytes, worker-output bytes, and model-budget pressure after the new format is active.
- [x] 4.2 Extend client debug stats/HUD to show enough voxel loading counters to compare worker input, decoded bytes, output bytes, decode time, and memory by LOD without relying on idle FPS.
- [x] 4.3 Re-sample dense LOD1 model regions after parametric greedy encoding and decide whether the current model-quad cap should remain, be lowered, or become byte-budget based.
- [x] 4.4 If model budget behavior changes, update metrics and docs to describe the fallback and make dropped model geometry visible.

## 5. Behavior Verification

- [x] 5.1 Verify optimized greedy cube geometry decodes to identical world-space cube boundaries at multiple LODs.
- [x] 5.2 Verify transparent quads still render through the transparent mesh path and do not become terrain-underlay occluders.
- [x] 5.3 Verify cursor hover block IDs for optimized greedy cube faces, model-backed faces, and transparent faces.
- [x] 5.4 Verify warm-cache restoration, eviction, stale refresh, and resource disposal still work with optimized voxel tile resources.
- [x] 5.5 Verify stationary LOD selection remains stable at the regression URL after all voxel fetch and mesh work reaches idle.

## 6. Documentation And Final Verification

- [x] 6.1 Update `docs/architecture-overview.md` for the optimized voxel payload, cache-version, metrics, and client/server contract changes.
- [x] 6.2 Update `docs/client-specification.md` for worker payload decoding, direct quadrant output, debug stats, hover identity, and transparent rendering behavior.
- [x] 6.3 Update `docs/server-specification.md` for payload encoding, `VoxelMeshService` metrics, benchmark route behavior, and model-budget diagnostics.
- [x] 6.4 Run `npm run check && npm run check:knip && npm run typecheck`.
- [x] 6.5 Run `npm run build` because the change touches worker decoding, route payloads, and TypeScript boundaries.
- [x] 6.6 Re-test the regression URL and compare loaded counts by LOD, memory by LOD, worker input bytes, decoded bytes, decode time, raw payload bytes, worker-output bytes, and model-budget pressure against the captured baseline.
