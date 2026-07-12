## 1. Deterministic Test Boundaries

- [x] 1.1 Define narrow injectable worker-pool and emitter-summary collaborator types for `VoxelMeshService` while preserving production defaults
- [x] 1.2 Add shared deferred-job, fake-service, HTTP request, coordinate-matrix, and temporary terrain fixture helpers needed by the new suites
- [x] 1.3 Add the smallest deterministic watcher scheduling/path seam needed to test debounce and batching without real sleeps or OS watcher races

## 2. Voxel Service Orchestration

- [x] 2.1 Add tests proving same-key concurrent requests share one generation job and completed cache hits avoid new work
- [x] 2.2 Add tests proving key invalidation and global invalidation reject pending stale results from the active cache
- [x] 2.3 Add tests for Brotli and gzip generation, stable per-encoding ETags, variant reuse, and normal-versus-no-halo cache isolation
- [x] 2.4 Add coordinate-matrix tests for LOD 1 neighboring-leaf and LOD 2 through LOD 32 summary-ancestor invalidation, including negative boundaries
- [x] 2.5 Correct any service invalidation or cache-state defects exposed by the behavioral tests without changing the public contract

## 3. Voxel HTTP Contract

- [x] 3.1 Build a hermetic Express route harness around `createVoxelsRouter` and the standard error boundary
- [x] 3.2 Add table-driven tests for Brotli, gzip, wildcard, quality, exclusion, preference, and unsupported encoding negotiation
- [x] 3.3 Add tests for aligned success, 204 empty, 304 conditional, ETag, `Vary`, content/cache headers, and diagnostic `halo=0` service arguments
- [x] 3.4 Add tests for unsupported LODs, non-finite and misaligned coordinates, and incomplete metrics coordinate triples
- [x] 3.5 Correct any route negotiation, validation, or response-header defects exposed by the contract tests

## 4. Live Update Mechanics

- [x] 4.1 Add terrain-update tests for the complete 3 by 3 gutter neighborhood, query invalidation, warm/loaded eviction, and terrain-enabled reload behavior
- [x] 4.2 Add LOD 1 voxel-update tests for halo-neighbor leaves, aligned coarse ancestors, direct refresh eligibility, and deduplication
- [x] 4.3 Add tests for aborting active fetches, removing obsolete fetch work, retaining only current-version mesh work, and clearing missing/failed/loading state
- [x] 4.4 Add explicit positive, zero, and negative boundary coordinate cases and correct any floor-alignment defects they expose

## 5. Save Watcher Semantics

- [x] 5.1 Add surface path tests for change/add/remove events, tile alignment, index notifications, invalid paths, and negative coordinates
- [x] 5.2 Add region path tests for vertical-column collapse, change/add/remove events, batch deduplication, invalid paths, and negative coordinates
- [x] 5.3 Add deterministic player/world debounce, mixed terrain batch, and stop-with-pending-work tests
- [x] 5.4 Correct watcher path parsing, lifecycle, or batching defects exposed by the semantic tests

## 6. Terrain Seam Contract

- [x] 6.1 Extend deterministic surface fixtures to create adjacent same-LOD tiles with an observable shared edge and one-vertex gutters
- [x] 6.2 Pass both fixtures through the production terrain response and client build boundary and compare shared-border positions and normals
- [x] 6.3 Add a changed-gutter-source case proving the neighboring tile is included in invalidation and rebuild coverage

## 7. Commands And Documentation

- [x] 7.1 Add focused npm scripts for service/API, watcher, client runtime, and terrain contract suites and include all correctness suites in `npm test`
- [x] 7.2 Update `AGENTS.md` and the matching contributor/test documentation with suite ownership, hermetic requirements, focused commands, and verification order
- [x] 7.3 Update architecture and client/server specifications only if implementation fixes alter a shared contract or documented runtime flow

## 8. Verification

- [x] 8.1 Run every focused new test command and the existing focused voxel server, client, and contract commands
- [x] 8.2 Run `npm test && npm run check && npm run check:knip && npm run typecheck`
- [x] 8.3 Run `npm run build` because route and TypeScript service boundaries may change
