## 1. Aggregation Rules

- [ ] 1.1 Define coarser LOD aggregation thresholds for source strength, cluster size, color combination, and maximum records per payload.
- [ ] 1.2 Decide whether aggregation uses fine source cells, coarser block samples, or existing mesh traversal data.
- [ ] 1.3 Determine cache signature changes needed for coarser LOD emitter output.

## 2. Server Payload Generation

- [ ] 2.1 Generate representative emitter records for LODs greater than 1 using the chosen aggregation rules.
- [ ] 2.2 Preserve current detailed per-block emitter behavior for LOD 1.
- [ ] 2.3 Update voxel payload metrics to distinguish detailed and aggregated emitter records when useful.

## 3. Client Rendering And LOD Behavior

- [ ] 3.1 Ensure the client worker and block-light runtime consume coarser LOD emitter records through the existing emitter pipeline.
- [ ] 3.2 Tune mesh-local emitted-light contribution for aggregated emitters so distant light cues are visible but not oversized.
- [ ] 3.3 Tune runtime source accents for coarser LOD records so distant views do not become cluttered.

## 4. Documentation

- [ ] 4.1 Update `docs/server-specification.md` for coarser LOD emitter aggregation and cache behavior.
- [ ] 4.2 Update `docs/client-specification.md` for coarser LOD emitted-light rendering behavior.
- [ ] 4.3 Update `docs/architecture-overview.md` if shared payload semantics change.

## 5. Verification

- [ ] 5.1 Run `npm run check`.
- [ ] 5.2 Run `npm run check:knip`.
- [ ] 5.3 Run `npm run typecheck`.
- [ ] 5.4 Run `npm run build` because this changes server payload generation and client worker boundaries.
- [ ] 5.5 Manually verify strong or clustered light sources remain visible when the camera switches from LOD 1 to coarser voxel LODs.
