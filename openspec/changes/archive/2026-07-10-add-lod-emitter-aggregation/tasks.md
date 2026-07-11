## 1. Aggregation Rules

- [x] 1.1 Define coarser LOD aggregation thresholds for source strength, cluster size, color combination, and maximum records per payload.
- [x] 1.2 Decide whether the first implementation uses same-LOD source data only or includes a bounded LOD 1 source fallback for cases where same-LOD data loses important emitters.
- [x] 1.3 Keep the first implementation on the existing emitter record layout unless visual validation proves radius/intensity/count metadata is required.
- [x] 1.4 Define payload, server-generation, client emissive-bake, and runtime accent budgets using the current halo and emissive benchmark metrics.
- [x] 1.5 Determine cache signature changes needed for aggregation thresholds, source-data strategy, and any payload content changes.

## 2. Server Payload Generation

- [x] 2.1 Generate representative emitter records for LODs greater than 1 using the chosen aggregation rules.
- [x] 2.2 Preserve current detailed per-block emitter behavior for LOD 1.
- [x] 2.3 Ensure coarser LOD payloads pass aggregated emitter records to `encodeBinaryQuads` instead of stripping all non-LOD1 emitters.
- [x] 2.4 Update voxel payload metrics to distinguish detailed, halo, and aggregated emitter records when useful.
- [x] 2.5 Update voxel invalidation expansion if aggregated coarser emitters depend on neighboring or finer source regions.

## 3. Client Rendering And LOD Behavior

- [x] 3.1 Ensure the client worker and block-light runtime consume coarser LOD emitter records through the optimized emissive pipeline, including compact normalized attributes and quad culling.
- [x] 3.2 Tune mesh-local emitted-light contribution for aggregated emitters so distant light cues are visible but not oversized.
- [x] 3.3 Tune runtime source accents for coarser LOD records so distant views do not become cluttered.
- [ ] 3.4 Verify coarser LOD aggregated records do not materially regress emissive bytes, emissive grid time, emissive bake time, or evaluated/cull ratios beyond the defined budgets.

## 4. Documentation

- [x] 4.1 Update `docs/server-specification.md` for coarser LOD emitter aggregation and cache behavior.
- [x] 4.2 Update `docs/client-specification.md` for coarser LOD emitted-light rendering behavior.
- [x] 4.3 Update `docs/architecture-overview.md` if shared payload semantics change.

## 5. Verification

- [x] 5.1 Run `npm run check`.
- [x] 5.2 Run `npm run check:knip`.
- [x] 5.3 Run `npm run typecheck`.
- [x] 5.4 Run `npm run build` because this changes server payload generation and client worker boundaries.
- [ ] 5.5 Manually verify strong or clustered light sources remain visible when the camera switches from LOD 1 to coarser voxel LODs.
- [ ] 5.6 Benchmark representative LOD transition scenes with current debug metrics, recording aggregated emitter counts, emissive bytes, emissive grid time, emissive bake time, and runtime accent degradation.
- [ ] 5.7 Verify cache invalidation by changing aggregation behavior or source data and confirming stale coarser LOD no-emitter payloads are not reused.
