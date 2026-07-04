## 1. Height Source Analysis

- [x] 1.1 Confirm current terrain-mode and voxel-mode biome label Z calculations in `biome-labels.ts`.
- [x] 1.2 Inspect loaded voxel tile metadata, including `chunkTopHeights`, `regionX`, `regionY`, `lod`, `voxelSize`, `minZ`, and `maxZ`, to determine the best local centroid lookup.
- [x] 1.3 Decide whether existing client-side voxel metadata is sufficient or whether a route/payload contract change is required.

## 2. Local Voxel Height Placement

- [x] 2.1 Add a world-XY local voxel height resolver for biome label centroids using loaded voxel tile data.
- [x] 2.2 Update voxel-mode biome label candidate creation so each label computes Z from its own centroid instead of inheriting a tile-level Z.
- [x] 2.3 Preserve deterministic fallback placement when no local voxel height is available.
- [x] 2.4 Ensure voxel tile load/unload events continue to mark biome labels dirty so fallback labels can be recomputed when local data appears.

## 3. Behavior And Contract Review

- [x] 3.1 Verify terrain-mode biome label placement remains unchanged.
- [x] 3.2 Verify voxel-mode labels over varied local heights no longer collapse to camera target height or region-wide max height.
- [x] 3.3 If any `/api/biomes`, voxel payload, or worker protocol contract changes were required, update `docs/architecture-overview.md` and the affected client/server specification doc.

## 4. Verification

- [x] 4.1 Run `npm run check`.
- [x] 4.2 Run `npm run check:knip`.
- [x] 4.3 Run `npm run typecheck`.
- [x] 4.4 Run `npm run build` if implementation changes worker payloads, route payloads, or TypeScript build boundaries.
