## 1. Y-Axis Seam Regression Coverage

- [x] 1.1 Extend the hermetic adjacent-region fixture support to create an LOD 1 Y-axis seam with cross-boundary emitters and deliberately asymmetric unrelated emitter populations.
- [x] 1.2 Add a production server-payload and client-worker contract test that collects matching Y-seam vertices by world position and normal and asserts normalized emissive agreement within one compact encoding step.
- [x] 1.3 Prove the fixture exercises the regression by verifying both own and halo records are present for the cross-boundary source while the two payloads retain different unrelated emitter populations.

## 2. Deterministic Client Candidate Discovery

- [x] 2.1 Update `accumulateEmitterLight` to gather deduplicated candidates from the complete bounded neighboring-cell footprint required by the configured falloff radius, without a primary-cell early exit.
- [x] 2.2 Preserve radius-aware insertion, open-face transmission, nearest-candidate ordering and cap, power gain, compact attribute encoding, and bounded worker memory behavior.
- [x] 2.3 Add focused worker coverage for an in-radius emitter located outside a receiver's primary grid cell when unrelated primary-cell records are present.

## 3. Documentation And Verification

- [x] 3.1 Update `docs/architecture-overview.md` and `docs/client-specification.md` to describe deterministic mesh-local seam candidate discovery independent of own versus halo ownership and unrelated payload records.
- [x] 3.2 Run focused voxel seam and worker tests, including the new Y-axis regression.
- [x] 3.3 Run `npm test && npm run check && npm run check:knip && npm run typecheck`.
- [x] 3.4 Run `npm run build` to validate the browser worker and TypeScript boundary.
