## Why

The viewer can render glow sprites and mesh-local illumination at coordinates where no light source is visible. LOD 1 emitter collection can retain hidden sources, and coarse LOD summaries currently aggregate every raw emitted-light block, including sources that Cubyz removes from its coarse geometry.

## What Changes

- Define emitted-light eligibility in terms of source geometry that is actually represented in the requested voxel payload.
- Prevent hidden, depth-suppressed, and LOD-replaced source blocks from creating runtime glow sprites or mesh-local illumination.
- Derive coarse emitter representatives from visibility-qualified LOD 1 sources so coarse lights do not appear in empty space.
- Limit LOD 1 halo collection to sources that can affect generated visible geometry, including a bounded visible vertical envelope.
- Invalidate emitter summaries and persistent voxel payloads when the new eligibility and halo-selection behavior changes.
- Preserve illumination continuity for visible emitter sources across voxel-region and coarse-LOD boundaries.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `block-emissive-lighting`: Require LOD 1, halo, and coarse emitter records to correspond to represented source geometry and visible receiving geometry.

## Impact

- Server voxel generation, halo collection, emitter summaries, cache identity, and diagnostics.
- Client emitter lifecycle and runtime glow/point-light accents, with no binary payload layout change expected.
- `docs/architecture-overview.md`, `docs/server-specification.md`, and `docs/client-specification.md` must describe the updated visible-emitter pipeline.
