## 1. Block Visual Metadata

- [x] 1.1 Add palette-indexed block visual metadata that distinguishes air, opaque renderable, and transparent renderable blocks.
- [x] 1.2 Load transparent-related Cubyz block fields from layered block definitions, including inherited `_defaults.zig.zon` values.
- [x] 1.3 Stop classifying `cubyz:glass/` blocks as air-like solely by ID prefix.
- [x] 1.4 Derive transparent block tint from existing texture/absorption color behavior and preserve normal opaque block RGB behavior.

## 2. Voxel Generation

- [x] 2.1 Update voxel traversal so transparent renderable blocks are traversable but still emit transparent faces.
- [x] 2.2 Keep air blocks non-renderable and opaque blocks traversal-blocking.
- [x] 2.3 Avoid redundant internal transparent faces and merge same-type transparent exterior faces so connected glass reads as a unified volume.
- [x] 2.4 Preserve palette indices for transparent faces so voxel hover identity works on transparent geometry.
- [x] 2.5 Exclude transparent-only top faces from fully opaque terrain-underlay occlusion coverage.

## 3. Payload And Worker Contract

- [x] 3.1 Extend the voxel binary payload to identify or group transparent quads separately from opaque quads.
- [x] 3.2 Update server binary encoding and comments for the new transparent render information.
- [x] 3.3 Update the browser voxel worker decoder to produce separate opaque and transparent mesh arrays while preserving colors, normals, AO, winding, positions, and palette indices.
- [x] 3.4 Bump voxel cache and/or payload semantic versioning so stale opaque-only cached meshes are not reused.

## 4. Client Rendering

- [x] 4.1 Add a transparent voxel material that renders after opaque voxels with transparent blending and `depthWrite` disabled.
- [x] 4.2 Build transparent voxel submeshes separately from opaque voxel submeshes and keep lifecycle/disposal behavior consistent.
- [x] 4.3 Ensure cursor picking can identify transparent voxel faces using the existing block palette lookup path.
- [x] 4.4 Manually tune fixed or metadata-derived opacity so multiple glass layers remain visibly transparent while glass structures remain legible.

## 5. Documentation

- [x] 5.1 Update `docs/architecture-overview.md` for the new block visual metadata and opaque/transparent voxel rendering contract.
- [x] 5.2 Update `docs/server-specification.md` for transparent block classification, voxel traversal, payload encoding, and cache invalidation behavior.
- [x] 5.3 Update `docs/client-specification.md` for worker decoding, transparent voxel materials, hover identity, and terrain-underlay behavior.

## 6. Verification

- [x] 6.1 Run `npm run check`.
- [x] 6.2 Run `npm run check:knip`.
- [x] 6.3 Run `npm run typecheck`.
- [x] 6.4 Run `npm run build` because voxel worker/server payload boundaries change.
- [x] 6.5 Manually verify in voxel view that glass is visible and transparent, multiple glass blocks still reveal opaque blocks behind them, and opaque voxel rendering remains unchanged.
