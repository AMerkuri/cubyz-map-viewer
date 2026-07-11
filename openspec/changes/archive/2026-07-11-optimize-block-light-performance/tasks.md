## 1. Establish Baselines

- [x] 1.1 Record fixed nighttime LOD 1 captures and worker emissive phase metrics for an emitter-dense area using `npm run validate:voxel-lighting -- --lod 1` with the existing viewer running.
- [ ] 1.2 Record idle and active main-thread behavior, decoded/active emitter counts, scene object/material counts, and cache-miss `X-Voxel-Halo-Ms` headers for the same representative area.
- [x] 1.3 Define fixture inputs for every seam-validation-matrix case: X/Y edges, corners, vertical scan extremes, dense own records, dense both sides, and missing/special neighbors.

## 2. Frame-Scheduled Runtime Accents

- [x] 2.1 Add a loaded-voxel revision that increments for voxel tile add, removal, and replacement, and make block-light region synchronization depend on that revision rather than a per-frame tile scan.
- [x] 2.2 Move block-light synchronization and accent updates after the effective frame-cap early return while preserving the mesh-emissive state on each rendered frame.
- [x] 2.3 Make disabled/daytime accent handling transition-safe: hide active glow and point-light slots once, keep the daytime emissive floor, and avoid steady-state emitter flattening and visibility traversal.
- [x] 2.4 Replace per-tile emitter sprite groups with one reusable global glow pool capped at `HIGH_GLOW_BUDGET`, retaining only emitter metadata per loaded tile.
- [x] 2.5 Replace runtime full sorting with deterministic bounded nearest-emitter selection, reuse glow slots and per-slot materials, and preserve point-light and glow quality budgets.
- [x] 2.6 Update runtime memory/stat reporting so global pool cost and utilization are represented without attributing per-emitter sprite memory to each tile.

## 3. Worker Emissive Bake Selection

- [x] 3.1 Refactor `accumulateEmitterLight` to reuse primitive scratch storage and remove the per-vertex mapped candidate-object, filtered-array, sorted-copy, and sliced-copy chain.
- [x] 3.2 Implement bounded top-`maxCandidatesPerVertex` selection that preserves reachable-candidate filtering and squared-distance then emitter-index ordering.
- [x] 3.3 Compare representative worker output and emissive phase metrics against the baseline to confirm preserved visuals/culling with lower or unchanged bake cost.

## 4. Halo Traversal and Capped Retention

- [x] 4.1 Add generation-local unified traversability caching for target and external halo cells while preserving missing-chunk, out-of-range-Z, transparent, model, semantic-block, and shape behavior.
- [ ] 4.2 Verify batching-only halo changes preserve uncapped payload records byte-for-byte and reduce or do not regress cache-miss halo generation timing.
- [x] 4.3 Implement deterministic boundary-aware halo retention at the 8,192-record cap, including protected X/Y edge allocation or ranking, corner deduplication, vertical relevance, deterministic tie-breaking, and documented fallback filling.
- [x] 4.4 Increment `VOXEL_GENERATOR_CACHE_VERSION` with the retention-policy change so stale persistent payloads cannot be served under the new selection semantics.
- [ ] 4.5 Add repeatable payload and baked-light validation for every seam-matrix fixture both below cap and under dense own-record cap pressure.

## 5. Documentation and Observability

- [x] 5.1 Update `docs/client-specification.md` with rendered-frame runtime scheduling, inactive accent behavior, bounded global accent pools, and the distinction between baked emissive and dynamic point-light accents.
- [x] 5.2 Update `docs/server-specification.md` with halo traversal reuse, deterministic capped-retention behavior, cache-version invalidation, and the seam-validation evidence required for changes.
- [x] 5.3 Update `docs/architecture-overview.md` with the corrected client worker/runtime/server light pipeline and payload-selection cache boundary.
- [x] 5.4 Add or update debug-only metrics for block-light runtime duration and pool utilization if baseline comparison cannot otherwise expose regressions.

## 6. Verify

- [ ] 6.1 Run the complete seam-validation matrix, inspect decoded retained halo records and fixed-camera baked-light results, and record uncapped/capped outcomes.
- [x] 6.2 Re-run fixed-LOD nighttime captures and compare worker, runtime, and visual metrics with the recorded baseline.
- [x] 6.3 Run `npm run check && npm run check:knip && npm run typecheck`.
- [x] 6.4 Run `npm run build` because the browser worker and server payload/cache boundary change.
