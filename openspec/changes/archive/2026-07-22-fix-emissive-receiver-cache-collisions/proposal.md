## Why

The client emissive baker packs three 21-bit receiver-cell coordinates into a JavaScript `number`, exceeding its 53-bit safe integer range and causing distinct vertical cells to share candidate neighborhoods. Real LOD 1 payloads consequently omit eligible torch contributions and render structures dark even though the server payload contains the correct emitters.

## What Changes

- Replace unsafe receiver-cell and sparse emitter-grid identities with collision-free lookup behavior across the supported coordinate range.
- Preserve the cached bake optimization while guaranteeing byte-identical output with uncached candidate discovery.
- Provide a correctness-first fallback when a receiver cannot be represented by the optimized cache layout or when cache capacity is exhausted.
- Add realistic multi-height and non-origin regressions that expose coordinate aliasing, including cached-versus-uncached output parity.
- Validate the reported LOD 1 payload shape and document the corrected client lighting runtime behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `client-emissive-bake-performance`: Strengthen receiver-cell identity, sparse-grid identity, and representative parity requirements so cached discovery cannot substitute candidates between distinct three-dimensional cells.

## Impact

- Affects the browser voxel worker in `src/client/features/world-view/workers/voxel-mesh.worker.ts` and its client voxel correctness and benchmark coverage.
- Does not change the `/api/voxels` binary payload, server generation, HTTP routes, persisted data, or external dependencies.
- Requires updates to `docs/architecture-overview.md` and `docs/client-specification.md` because the documented client emissive-bake runtime and correctness fallback change.
- Requires the normal checks plus the client voxel suites and production build because a browser worker boundary is involved.
