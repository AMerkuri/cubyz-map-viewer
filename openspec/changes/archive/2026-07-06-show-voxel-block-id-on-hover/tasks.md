## 1. Server Voxel Contract

- [x] 1.1 Extend the voxel mesh binary encoder to include a compact per-quad block palette index section while preserving existing color, AO, winding, position, and chunk coverage data.
- [x] 1.2 Ensure voxel mesh cache signatures or response validation account for the updated binary payload shape so stale cached meshes cannot be decoded incorrectly.
- [x] 1.3 Expose the save block palette entries to the client through a lightweight world/session API path or existing world-data payload without adding per-hover lookups.

## 2. Client Voxel Decode And Metadata

- [x] 2.1 Update shared client voxel worker types to carry per-face or per-triangle palette index metadata from decoded voxel payloads.
- [x] 2.2 Update the voxel mesh worker decoder to parse the new palette index section defensively and preserve metadata through quadrant splitting.
- [x] 2.3 Attach block palette metadata to built voxel submeshes so `intersection.faceIndex` can resolve the hovered face's palette index after raycasting.
- [x] 2.4 Load and retain the block palette string table on the client so palette indices can resolve to saved block IDs.

## 3. Hover Reporting And HUD

- [x] 3.1 Extend `CursorHoverInfo` with optional `blockId` metadata.
- [x] 3.2 Update voxel hover resolution to include `blockId` only for selected voxel mesh intersections with resolvable palette indices.
- [x] 3.3 Preserve terrain-underlay hover as coordinate-only and preserve coordinate display when block mapping is missing.
- [x] 3.4 Update the cursor HUD formatter to append the block ID for voxel hover and exclude block data, orientation, or variant metadata.

## 4. Documentation

- [x] 4.1 Update `docs/architecture-overview.md` to describe the voxel hover block identity data flow and contract impact.
- [x] 4.2 Update `docs/client-specification.md` with the cursor HUD behavior and client voxel metadata expectations.
- [x] 4.3 Update `docs/server-specification.md` with the voxel payload/palette contract changes.

## 5. Verification

- [x] 5.1 Run `npm run check`.
- [x] 5.2 Run `npm run check:knip`.
- [x] 5.3 Run `npm run typecheck`.
- [x] 5.4 Run `npm run build` because this changes route payloads, worker decode boundaries, and shared TypeScript contracts.
