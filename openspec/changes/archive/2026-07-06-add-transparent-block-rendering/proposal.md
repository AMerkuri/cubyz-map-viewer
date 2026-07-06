## Why

Glass blocks currently cannot be represented correctly in the map viewer: they are either flattened into opaque RGB voxel faces or treated like air and omitted. Cubyz exposes transparent block metadata, so the viewer should preserve visible, tinted, view-through glass in voxel mode.

## What Changes

- Add server-side transparent block metadata derived from layered Cubyz block definitions, including inherited `_defaults.zig.zon` values such as `.transparent`, `.hasBackFace`, and `.absorbedLight`.
- Distinguish air, opaque, and transparent renderable blocks during voxel mesh generation instead of using one `airLike` concept for both air and glass.
- Extend the voxel payload/worker/client rendering path so transparent voxel quads can be rendered separately from opaque voxel quads.
- Render transparent voxel faces with a map-viewer approximation that allows opaque blocks behind multiple glass blocks to remain visible.
- Update shared/client/server documentation for the voxel payload and rendering contract changes.

## Capabilities

### New Capabilities

- `transparent-voxel-rendering`: Server and client behavior for visible transparent voxel blocks such as Cubyz glass.

### Modified Capabilities

- None.

## Impact

- Server block visual metadata loading in `src/server/services/color-map.ts` and/or adjacent services.
- Server voxel generation in `src/server/services/voxel-generator.ts`, `greedy-mesh.ts`, worker protocol, and voxel cache versioning.
- Client voxel worker decoding in `src/client/features/world-view/workers/voxel-mesh.worker.ts`.
- Client Three.js voxel mesh construction/material setup in `src/client/features/world-view/lib/voxel-builders.ts` and `World3DView.tsx`.
- Shared documentation in `docs/architecture-overview.md`, `docs/server-specification.md`, and `docs/client-specification.md` because the voxel payload/rendering contract changes.
