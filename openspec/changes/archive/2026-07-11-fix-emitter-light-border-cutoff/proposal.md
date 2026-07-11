## Why

A recent client emitter-bake rewrite replaced the per-vertex 3×3×3 grid-cell probe with a single-cell probe, and removed the one-cell grid padding that previously absorbed rounding differences at cell boundaries. As a result emitted light now stops abruptly on chunk/region seams instead of spreading into neighboring surfaces, even though the server still supplies the correct own-region and neighbor halo emitter records. Nighttime lit areas show hard straight-line cutoffs aligned to the emitter grid, which regresses the intended Cubyz-like local illumination.

## What Changes

- Restore continuous cross-cell and cross-region emitted-light spread in the client voxel worker so a surface near a seam still receives light from emitters (including neighbor halo emitters) within the configured radius.
- Make emitter grid-cell insertion coverage and per-vertex candidate lookup consistent so an emitter that can influence a vertex is always discoverable from that vertex's cell.
- Align the radius used for grid-cell insertion with the (quantization-padded) radius used for falloff so insertion coverage is never smaller than falloff reach.
- Keep the performance intent of the rewrite (bounded candidates per vertex, radius-overlap indexing, broad-emitter fallback) while eliminating the seam cutoff.
- Preserve unchanged LOD 1 detail-light behavior and the existing coarse-LOD power/footprint compensation, clamps, and budgets.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `block-emissive-lighting`: The client mesh-local emitter bake SHALL deliver light continuously across emitter-grid cell and voxel-region boundaries within the configured emitted-light radius, with no seam-aligned cutoff, so a receiving surface finds every emitter (own-region or neighbor halo) whose radius reaches it.

## Impact

- Client voxel worker emitter-grid construction, quad culling, and per-vertex emissive accumulation in `src/client/features/world-view/workers/voxel-mesh.worker.ts`.
- No change to server voxel generation, `/api/voxels` payload format, emitter halo collection, or cache identity; this is a client-side bake correctness fix over the existing payload contract.
- Client behavior only. Verification via `npm run check && npm run check:knip && npm run typecheck` plus `npm run build` because the change touches the voxel worker boundary.
- If rendering semantics documentation describes the bake candidate model, update `docs/client-specification.md`; otherwise no doc contract change is required.
