## Why

LOD1 emitted light can still stop exactly at a voxel-region seam when a dense halo payload exceeds its 8,192-record cap. The current cap retains arbitrary edge records rather than all records that can illuminate visible receiving boundary geometry, leaving adjacent meshes with different baked light despite sharing physical vertices.

## What Changes

- Make capped LOD1 halo selection retain emitters whose falloff intersects visible geometry at each receiving region boundary.
- Preserve equivalent source coverage for matching visible vertices on both sides of an LOD1 region seam without sending every neighboring emitter.
- Invalidate persistent voxel payloads when the capped halo-selection algorithm changes.
- Add regression validation that runs the production mesh worker and compares baked emissive attributes at matching capped-seam vertices.
- Compose boundary-reaching same-LOD summary representatives into adjacent coarse payloads so LOD `2` through `32` do not bake from disjoint emitter sets at region seams.
- Record targeted seam diagnostics that distinguish payload-cap loss from normal unloaded-neighbor behavior.

## Capabilities

### New Capabilities

- `capped-halo-seam-continuity`: Retention and validation of boundary-relevant halo emitters when an LOD1 voxel payload reaches its record cap.

### Modified Capabilities

- `block-emissive-lighting`: LOD1 mesh-local block light must remain continuous across visible region boundaries under halo-record cap pressure.

## Impact

- Server: `voxel-generator.ts`, `VoxelMeshService` coarse-summary composition, voxel cache versioning, and voxel-generation diagnostics.
- Client: the browser voxel worker validation path and targeted debug visibility for cap-driven seam cases; no new public HTTP payload fields are expected unless diagnostics require them.
- Tooling: `scripts/validate-voxel-seams.ts` gains exact worker-bake seam assertions.
- Documentation: server, client, and architecture documentation must describe capped-halo selection and cache invalidation behavior.
