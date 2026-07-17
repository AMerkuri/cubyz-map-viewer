## 1. Progressive Enhancement Lifecycle

- [x] 1.1 Define a phase-aware enhancement-target validity predicate based on the current loaded tile, fresh refresh version, and matching base mesh identity.
- [x] 1.2 Update voxel request reconciliation so loss of fetch demand cancels obsolete base work but retains enhancement work with a valid loaded-base target.
- [x] 1.3 Apply the same target predicate to enhancement attachment and unload, replacement, stale-refresh, and warm-cache lifecycle handling so invalid targets cancel or reject safely.
- [x] 1.4 Preserve exact-once scheduler accounting for retained compact input, worker reservations, enhancement output, cancellation acknowledgements, and result-transfer races.

## 2. Regression Coverage And Documentation

- [x] 2.1 Add a hermetic pipeline regression test for base insertion, fresh-tile request reconciliation, enhancement completion, and normalized emissive attribute attachment.
- [x] 2.2 Add hermetic invalidation tests proving unload, warm-cache movement, refresh supersession, stale state, and base-identity replacement still cancel or reject enhancement without mutating unrelated geometry.
- [x] 2.3 Update `docs/architecture-overview.md` and `docs/client-specification.md` to distinguish fetch demand from progressive enhancement target validity and document the preserved runtime accent separation.

## 3. Verification

- [x] 3.1 Run focused progressive worker, pipeline-runtime, scheduler, and block-light runtime tests.
- [x] 3.2 Run `npm test && npm run check && npm run check:knip && npm run typecheck`.
- [x] 3.3 Run `npm run build` to verify the browser worker and TypeScript boundaries.
- [x] 3.4 Manually compare midnight progressive Balanced and Quality views against one-phase Balanced to confirm mesh-local terrain illumination returns while runtime accents retain their independent behavior.
