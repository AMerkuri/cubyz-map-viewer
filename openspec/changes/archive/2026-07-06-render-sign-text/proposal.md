## Why

Sign blocks in Cubyz carry player-authored text (e.g. "Hello world"), but the map viewer renders signs as blank geometry only. The text is already present in the `.region` files we read — the parser deliberately skips the block-entity stream where it lives — so we are discarding data that would make the map materially more useful for navigation and world annotation. Rendering that text on the sign face, as the game does, closes an obvious fidelity gap.

## What Changes

- Parse the previously-skipped block-entity stream in `.region` chunk blobs to recover per-sign UTF-8 text keyed by chunk-local block position.
- Collect per-sign records (world position, orientation `data` 0-19, text, and the text-plane corners) during voxel mesh generation, where both the block `data` and the block-entity text are available in one pass.
- Serve sign records to the client through a dedicated HTTP route that goes through `VoxelMeshService`, keeping the binary voxel mesh payload geometry-only.
- Render sign text on the client as a single texture-mapped quad glued to the sign's front face, mirroring the game's render-to-texture approach (128x72 canvas, 4px margin, Unscii-16, black, per-line centered, `\n` + word-wrap).
- Gate sign text rendering so it appears only when closely zoomed in (LOD 1), matching the "readable up close" intent.
- Update shared-contract documentation for the new sign route and payload.

## Capabilities

### New Capabilities
- `sign-text-parsing`: Server-side decoding of the `.region` block-entity stream into per-sign text records associated with block positions and orientation.
- `sign-text-rendering`: Client-side rendering of sign text on the sign face as an oriented textured quad, LOD-gated to close zoom, matching in-game layout.

### Modified Capabilities
<!-- No existing capability's requirements change; voxel mesh payload stays geometry-only. -->

## Impact

- **Server parsers**: `src/server/parsers/region.ts` stops skipping block-entity bytes and returns per-chunk sign entries.
- **Server services**: `VoxelMeshService` / `src/server/services/voxel-generator.ts` collect sign records (position, `data`, text, text-plane corners) during meshing.
- **Server API**: new sign route under `src/server/api/` (routed through `VoxelMeshService`), returning per-region sign records as JSON.
- **Client data layer**: new React Query hook in `src/client/features/world-view/` to fetch sign records per region/LOD.
- **Client runtime**: `World3DView.tsx` scene runtime builds and disposes oriented text quads on sign faces, reusing the existing Unscii font asset used for labels.
- **Docs**: `docs/architecture-overview.md` plus `docs/server-specification.md` and `docs/client-specification.md` for the new sign route and rendering contract.
- **Dependencies**: none new; reuses existing canvas texture + Three.js primitives.
