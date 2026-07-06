## Why

Voxel hover tooltips currently show only coordinates, which makes it hard to inspect or debug world contents from the map viewer. Showing the hovered voxel block ID lets users identify visible blocks such as `cubyz:grass` or `cubyz:log/oak` directly from the rendered voxel scene.

## What Changes

- Add block ID metadata to voxel hover results when the pointer intersects rendered voxel geometry.
- Display the hovered block ID in the cursor HUD alongside X/Y/Z coordinates for voxel hits.
- Keep terrain-underlay hover behavior unchanged; terrain hits continue to show coordinates only.
- Do not display block data, orientation, or variant metadata.

## Capabilities

### New Capabilities

- `voxel-hover-block-identity`: Defines how voxel hover exposes and displays the block ID for the visible voxel face under the pointer.

### Modified Capabilities

None.

## Impact

- Client voxel hover flow in `src/client/features/world-view/lib/cursor.ts` and cursor HUD formatting in `src/client/app/components/WorldViewPageContent.tsx`.
- Client voxel worker/types/builders that decode and attach per-face block identity metadata to rendered voxel meshes.
- Server voxel mesh binary contract in `src/server/services/greedy-mesh.ts` and the `/api/voxels/:lod/:regionX/:regionY` response produced through `VoxelMeshService`.
- Block palette exposure or transfer so the client can map palette indices to saved block IDs.
- Documentation updates for the voxel payload/client-server contract in `docs/architecture-overview.md`, `docs/client-specification.md`, and `docs/server-specification.md`.
