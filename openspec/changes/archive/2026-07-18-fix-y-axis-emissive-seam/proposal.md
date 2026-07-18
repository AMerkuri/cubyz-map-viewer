## Why

LOD 1 mesh-local emitted light has a visible hard discontinuity across the Y-axis seam between regions `768/5504` and `768/5632`, even though the dim-side payload contains the relevant north-side halo emitters. The current worker's data-dependent candidate shortcut can make equivalent boundary vertices evaluate different emitter sets based on unrelated records in each region.

## What Changes

- Add a focused hermetic LOD 1 Y-axis seam regression that uses asymmetric adjacent-region emitter populations and verifies matching baked emissive values at shared receiving vertices.
- Make mesh-local emitted-light candidate discovery deterministic for every in-radius emitter, independent of whether a record is owned locally or supplied as a halo and independent of unrelated records in either region.
- Preserve bounded candidate work, existing falloff, open-face transmission, compact emissive output, and the current voxel payload format.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `block-emissive-lighting`: Mesh-local LOD 1 lighting must remain continuous across Y-axis region seams when equivalent own and halo emitters can reach shared receiving geometry.

## Impact

- Client voxel worker candidate lookup and emissive bake behavior in `src/client/features/world-view/workers/voxel-mesh.worker.ts`.
- Hermetic voxel contract coverage and seam-fixture support under `test/voxel/`.
- `docs/architecture-overview.md` and `docs/client-specification.md` to document the deterministic client seam-bake guarantee.
- No server route, binary payload, WebSocket, persisted-data, deployment, or runtime-accent contract changes.
