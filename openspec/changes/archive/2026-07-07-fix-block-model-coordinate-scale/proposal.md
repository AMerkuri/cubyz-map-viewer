## Why

Some Cubyz OBJ block models intentionally extend beyond one block, but the viewer currently treats any model coordinate above `1.5` as a legacy `0..16` voxel-unit model and divides all vertices by `16`. This shrinks `cubyz:monstera` from its Cubyz-authored roughly `1.8 x 1.8 x 1.6` block shape to about `0.11 x 0.11 x 0.10` blocks in the map viewer.

## What Changes

- Adjust server-side OBJ block model coordinate normalization so Cubyz-authored model dimensions are preserved for models such as `cubyz:monstera`.
- Keep supported model quads flowing through the existing `/api/voxels` fixed-point payload and client decode path.
- Invalidate persisted voxel mesh cache entries when the model coordinate interpretation changes.
- Update server/architecture documentation for the revised block model coordinate behavior.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `cubyz-block-model-shapes`: Supported Cubyz block OBJ model geometry must preserve authored coordinates, including models whose bounds exceed one block, instead of being shrunk by a broad coordinate-scale heuristic.

## Impact

- Affected server code: `src/server/services/block-shape-table.ts`, `src/server/services/voxel-cache-version.ts`, and possibly focused diagnostics around OBJ bounds.
- Affected behavior: `/api/voxels` mesh geometry for supported non-cube block models at LOD 1, especially `cubyz:monstera`.
- Affected docs: `docs/server-specification.md` and `docs/architecture-overview.md` because server-generated voxel geometry semantics change.
- No client route, WebSocket, or binary payload format changes are expected.
