## 1. Asset Shape Metadata

- [x] 1.1 Add server-side types for block shape metadata, model quads, fixed-point coordinates, fallback shape kinds, and a shape table signature.
- [x] 1.2 Implement layered block definition discovery that applies `_defaults.zig.zon` inheritance for block assets consistently with Cubyz asset conventions.
- [x] 1.3 Implement OBJ model parsing for `assets/*/models/*.obj` sufficient for Cubyz block quads, normals, UVs, and model bounds.
- [x] 1.4 Build a palette-indexed block shape table from the active save palette, block definitions, resolved model assets, supported rotation metadata, and `lodReplacement` values.
- [x] 1.5 Add once-per-block diagnostics for unsupported model references, missing model assets, and unsupported rotation modes while preserving startup success.
- [x] 1.6 Wire the block shape table through `src/server/index.ts`, `VoxelMeshService`, worker data, and voxel worker startup.

## 2. Binary Voxel Contract

- [x] 2.1 Replace integer-only vertex position encoding with a fractional-capable fixed-point representation in the server voxel binary encoder.
- [x] 2.2 Update the browser voxel mesh worker decoder to read fixed-point positions and produce identical world-space coordinates for existing full-cube quads.
- [x] 2.3 Update worker protocol/types and any quad stats or buffer-size calculations affected by the binary layout change.
- [x] 2.4 Bump the voxel generator cache version and include the block shape table signature in persistent mesh cache keys.

## 3. Voxel Mesh Generation

- [x] 3.1 Preserve the existing greedy meshing path for full-cube blocks and confirm cube quads still merge as before.
- [x] 3.2 Preserve each block's upper 16-bit `data` value during voxel generation so supported model variants can use it.
- [x] 3.3 Add explicit model-quad emission for supported LOD 1 non-cube blocks, using fixed-point local coordinates and existing block palette colors.
- [x] 3.4 Implement initial supported rotation/data behavior for `cubyz:no_rotation`, `cubyz:planar`, and `cubyz:torch` shape variants.
- [x] 3.5 Apply conservative higher-LOD handling for non-cube blocks using `lodReplacement` when available and documented fallback behavior otherwise.
- [x] 3.6 Keep model-quads non-occluding unless shape metadata proves full neighbor-boundary occlusion to avoid hiding adjacent cube faces incorrectly.

## 4. Client Rendering Integration

- [x] 4.1 Confirm decoded explicit model quads flow through existing quadrant mesh building, normals, colors, AO defaults, bounding boxes, and chunk top-height calculations.
- [x] 4.2 Ensure initial voxel-mode loading handles meshes containing non-cube model geometry without any terrain-to-voxel mode transition.
- [x] 4.3 Verify unsupported/fallback shapes do not produce malformed geometry, invalid bounds, or worker decode errors.

## 5. Documentation

- [x] 5.1 Update `docs/architecture-overview.md` with the revised `/api/voxels` binary vertex-position contract and block-shape rendering responsibility split.
- [x] 5.2 Update `docs/server-specification.md` with block shape asset loading, shape table caching/signature behavior, fallback behavior, and voxel generation changes.
- [x] 5.3 Update `docs/client-specification.md` with fixed-point voxel decoding and client worker expectations for explicit model quads.

## 6. Verification

- [x] 6.1 Run `npm run check` and fix any Biome issues.
- [x] 6.2 Run `npm run check:knip` and fix unused exports or dependency issues.
- [x] 6.3 Run `npm run typecheck` and fix TypeScript boundary issues.
- [x] 6.4 Run `npm run build` because the change modifies worker protocol, route payloads, and TypeScript boundaries.
- [x] 6.5 Manually inspect a world containing at least one supported torch or plant block and one normal terrain region to confirm non-cube geometry renders while terrain remains merged.
