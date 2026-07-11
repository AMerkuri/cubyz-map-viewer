## Why

Coarser voxel LODs currently derive emitter representatives from already-reduced same-LOD chunks, so many LOD 1 light sources disappear before aggregation and surviving clusters lose their combined power and spatial footprint. This makes lit areas progressively dimmer and smaller at each LOD transition instead of preserving the important nighttime cues visible at LOD 1.

## What Changes

- Derive coarser LOD emitter summaries from bounded LOD 1 emitted-light source data rather than relying only on lossy same-LOD voxel sources.
- Aggregate LOD 1 sources into a bounded set of coarse representatives that retain combined power, weighted color, centroid, and influence footprint closely enough to preserve perceived light energy.
- Apply bounded LOD-aware power and footprint compensation in the client mesh-local emissive bake, while retaining clamping and performance budgets that prevent coarse lights from becoming oversized or washed out.
- Keep detailed LOD 1 emitter and halo behavior unchanged.
- Extend cache identity, invalidation, diagnostics, and documentation for the finer-source dependencies and any emitter payload metadata or interpretation changes.
- Validate representative transition scenes across LOD 1, 2, 4, 8, 16, and 32 for brightness continuity, light footprint, payload size, server generation cost, and client emissive-bake cost.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `block-emissive-lighting`: Coarser LOD emitter records are derived from bounded LOD 1 source summaries and preserve aggregate power and influence footprint through explicit coarse-emitter semantics.
- `voxel-lod-stability`: LOD transitions preserve the perceived brightness and footprint of important emitted-light areas within defined visual and performance tolerances.

## Impact

- Server voxel generation, LOD 1 source loading or indexing, coarse emitter aggregation, voxel cache signatures, and terrain-update invalidation.
- The versioned `/api/voxels` emitter payload and client voxel worker if representative power or footprint requires additional metadata.
- Client emitter-grid construction, quad culling, per-vertex emissive accumulation, runtime source accents, and lighting diagnostics.
- `docs/architecture-overview.md`, `docs/server-specification.md`, and `docs/client-specification.md` must be updated with the new source strategy, payload semantics, cache behavior, and rendering interpretation.
- Full `check`, `check:knip`, `typecheck`, and `build` verification is required because server-worker-client binary boundaries are affected.
