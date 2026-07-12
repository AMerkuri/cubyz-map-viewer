## Why

The existing hermetic test suite strongly protects voxel emitter selection and cross-region lighting seams, but most runtime mechanics that deliver and refresh those payloads remain untested. Coverage should expand around stale-data prevention, transport correctness, invalidation, and terrain continuity rather than target an arbitrary line-coverage percentage.

## What Changes

- Add deterministic tests for `VoxelMeshService` cache reuse, concurrent request deduplication, compression variants, invalidation, and stale in-flight result rejection.
- Add HTTP contract tests for voxel encoding negotiation, validation, ETags, empty responses, cache headers, and diagnostic halo isolation.
- Add client tests for terrain and voxel live-update invalidation, including queue cancellation, ancestor refreshes, and negative-coordinate alignment.
- Add save watcher tests for path decoding, event debounce, batch deduplication, add/remove semantics, shutdown, and negative coordinates.
- Add a production-boundary terrain contract test that verifies neighboring same-LOD tiles remain seam-safe and that gutter dependencies are refreshed after a source tile changes.
- Extend the standard test commands and contributor documentation so the new core suites run hermetically without a real save, browser, or Cubyz installation.

## Capabilities

### New Capabilities

- `core-mechanics-test-suite`: Behavioral test guarantees for voxel delivery/cache semantics, live-update propagation, save watching, and terrain seam continuity.

### Modified Capabilities

None.

## Impact

- Adds tests and reusable fixtures under `test/` for server services/routes, client runtime helpers, watcher behavior, and terrain contracts.
- May introduce narrow dependency-injection seams or expose currently module-local pure helpers when needed for deterministic tests, without changing public HTTP or WebSocket behavior.
- Updates `package.json` test commands and contributor-facing documentation to describe the expanded hermetic suite.
- Does not intentionally change voxel payloads, HTTP contracts, live-update semantics, rendering behavior, or production dependencies.
