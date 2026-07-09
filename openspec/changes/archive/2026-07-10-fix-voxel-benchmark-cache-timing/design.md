## Context

The voxel-lighting diagnostic matrix now reports server run time, server halo time, worker decode time, output bytes, and emissive bytes. The first measurements are not internally consistent: reported halo time can be orders of magnitude larger than total server run time, and halo-enabled samples appear to use warm cached payloads while halo-disabled samples appear to trigger cold generation. That makes the matrix useful for client emissive cost but not yet reliable for server halo cost.

Current server timing flows through `VoxelMeshService` metrics into `/api/voxels` response headers, then the client reads those headers into worker benchmark samples and aggregates them in the debug HUD. Cache state is represented indirectly through `X-Voxel-Source` and server-local metrics, but the client benchmark does not count cache hits or misses, and averages do not distinguish cold worker generation from warm cache responses.

## Goals / Non-Goals

**Goals:**

- Report `X-Voxel-Halo-Ms` in milliseconds with the same request/job scope as `X-Voxel-Run-Ms`.
- Expose cache hit and cache miss counts in voxel benchmark samples and the debug HUD.
- Let diagnostic matrix results be interpreted as cold generation, warm cache serving, or mixed samples instead of hiding cache state.
- Preserve current voxel route, compression, worker, and rendering behavior.

**Non-Goals:**

- Optimize halo emitter collection or client emissive baking.
- Redesign persistent voxel cache keys beyond what is needed for accurate metrics.
- Add a new benchmark runner or automated performance test suite.
- Change `/api/voxels` compression requirements or payload geometry format.

## Decisions

1. Keep timing units normalized at the server boundary.

   `VoxelMeshService` and `voxel-generator` should store halo timing as elapsed milliseconds from `performance.now()`, and `/api/voxels` should emit that same unit in `X-Voxel-Halo-Ms`. The client should treat all server timing headers as milliseconds without additional conversion.

   Alternative considered: convert units on the client. That would preserve incorrect server semantics and make future server-side logs harder to compare with headers.

2. Add explicit cache source fields to benchmark samples.

   The client should read the existing response source header and any additional cache-hit indicator needed to classify each sample as cache hit, cache miss, or validation/not-modified when applicable. Aggregation should track counts for each class so averages can be interpreted correctly.

   Alternative considered: infer hits from `serverRunMs === 0`. That is brittle because a cache hit can still spend time reading/encoding, and a very fast miss could look similar after rounding.

3. Separate cold and warm averages where practical, and always show mix counts.

   The debug HUD should at minimum show total samples, cache hits, and cache misses. If the existing benchmark aggregation can be extended simply, it should also maintain cold-only and warm-only average server timings. If that becomes too invasive, showing counts beside the existing averages is sufficient for this change.

   Alternative considered: automatically flush caches between matrix cells. That would make results easier to compare but changes runtime behavior more aggressively and does not explain warm-cache behavior.

4. Preserve service layering.

   Cache classification should originate in `VoxelMeshService` and pass through `/api/voxels` headers or existing debug metadata. Routes should continue to call `VoxelMeshService`; the client should continue to collect benchmark data in the voxel request and worker flow.

   Alternative considered: add a separate debug endpoint for benchmark cache stats. That adds more API surface and would be harder to correlate with individual voxel samples.

## Risks / Trade-offs

- Cached payloads may include historical halo stats from the generation that created them, not time spent during the current request. Mitigation: label cache hits distinctly and avoid treating cached halo timing as current-request halo work.
- Browser resource timing can report unavailable or rounded transfer values. Mitigation: cache hit/miss counts should not depend on browser transfer metrics.
- `304 Not Modified` responses may bypass worker decode and not produce normal benchmark samples. Mitigation: only count cache classifications for samples that enter the existing benchmark path, or explicitly document if validation hits are excluded.
- Extra headers slightly expand the debug contract. Mitigation: keep fields debug-oriented, documented, and backward-compatible for older clients by treating missing fields as unknown.
