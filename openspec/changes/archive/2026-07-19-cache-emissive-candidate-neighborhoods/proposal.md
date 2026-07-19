## Why

The seam-correct emissive bake now probes a fixed 27-cell emitter-grid neighborhood for every evaluated vertex, producing roughly 3.4 million cell lookups per representative payload and worker jobs as long as 18 seconds. Candidate neighborhoods are identical for vertices in the same receiver cell, so the client should test whether reusing their deterministic union materially reduces bake time without increasing memory excessively or changing lighting output.

## What Changes

- Cache the deduplicated, payload-order candidate neighborhood for each receiver grid cell encountered during emissive baking and reuse it across vertices in that cell.
- Preserve exact per-vertex radius, open-face transmission, distance ordering, candidate limits, falloff, and compact emissive output semantics after cached neighborhood discovery.
- Add worker diagnostics that distinguish receiver-cell cache activity, raw neighborhood discovery work, and final candidate evaluation.
- Compare cached and uncached 27-cell discovery on representative sparse, dense, halo, coarse-LOD, and seam payloads for worker time, peak/additional memory, cache effectiveness, and normalized lighting parity.
- Retain the current uncached search as the comparison baseline until evidence demonstrates that caching meets explicit performance, memory, and parity acceptance criteria.
- Update client and architecture documentation for the worker-local cache lifecycle and diagnostics; no server payload or route changes are required.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `client-emissive-bake-performance`: Require reusable receiver-cell candidate neighborhoods to be evaluated against the uncached deterministic search with observable timing, memory, cache-effectiveness, and exact lighting-parity evidence.

## Impact

- Client voxel-worker candidate discovery and emissive metrics in `src/client/features/world-view/workers/voxel-mesh.worker.ts`.
- Worker benchmark result types, aggregation, and debug HUD presentation where needed to expose cache measurements.
- Hermetic client-worker and seam contract tests plus representative cached-payload benchmarks.
- `docs/architecture-overview.md` and `docs/client-specification.md`.
- No HTTP payload, server generation, WebSocket, shader, persistent cache, or default lighting-control contract change.
