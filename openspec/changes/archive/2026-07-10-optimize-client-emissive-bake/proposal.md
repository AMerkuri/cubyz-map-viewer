## Why

Cached-payload benchmarks on `SEASON3` show client emissive attributes increasing voxel worker decode/bake time from roughly `32.5 ms` to `392.0 ms` and adding about `1.9 MB` of emissive attribute output per averaged sample. Server halo collection has already been optimized, so the next bottleneck is client-side mesh-local emitted-light baking and transfer/upload cost.

## What Changes

- Optimize the client voxel worker's mesh-local emitted-light bake while preserving default visual quality.
- Replace string-keyed emitter-grid lookups in the per-vertex hot path with numeric/dense lookup structures.
- Skip emissive accumulation for quads that conservatively cannot receive emitted light.
- Reduce emissive attribute transfer/upload size by using normalized integer attributes when visually acceptable.
- Lazily allocate emissive output only for quadrants that actually receive emitted light.
- Add debug benchmark metrics that separate worker decode, emissive grid build, emissive bake, and emissive output size where useful.
- Preserve existing server voxel payloads, block-light semantics, runtime glow/point-light accents, and diagnostic emissive on/off controls.

## Capabilities

### New Capabilities

- `client-emissive-bake-performance`: Covers client worker mesh-local emitted-light bake performance, output representation, and phase metrics.

### Modified Capabilities

- `block-emissive-lighting`: Mesh-local emitted-light rendering must remain visually compatible while using optimized worker data structures and compact emissive attributes.
- `voxel-lighting-performance-diagnostics`: Diagnostics must distinguish emissive bake cost and emissive output size well enough to verify client-side improvements.

## Impact

- Client voxel worker in `src/client/features/world-view/workers/voxel-mesh.worker.ts`, especially emitter-grid construction, per-vertex accumulation, quadrant writers, and benchmark timing.
- Client voxel geometry upload in `src/client/features/world-view/lib/voxel-builders.ts` if emissive attributes switch from float to normalized integer arrays.
- Client shared types in `src/client/features/world-view/lib/types.ts` if `WorkerQuadrantMesh.emissiveColors` becomes a typed-array union.
- Block-light material patch in `src/client/features/world-view/lib/block-light-mesh.ts` should remain compatible with the existing `vec3 emissiveLight` shader input.
- Documentation in `docs/client-specification.md` and `docs/architecture-overview.md` if worker output representation or debug benchmark metrics change.
- Verification should include default checks plus `npm run build` because browser worker boundaries and typed array contracts are involved.
