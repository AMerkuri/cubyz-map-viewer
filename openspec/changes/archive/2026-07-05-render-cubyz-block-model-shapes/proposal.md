## Why

Voxel mode currently renders every non-air Cubyz block as a full unit cube, which makes torches, plants, lily pads, bars, chains, carpets, and other model-based blocks appear with incorrect dimensions. Cubyz already stores block model references and per-block data needed to render many of these shapes more accurately, so the viewer should use that information instead of treating all blocks as identical cubes.

## What Changes

- Add server-side Cubyz block model shape metadata derived from layered block definitions, model OBJ assets, palette entries, and block `data` where supported.
- Extend voxel mesh generation so full-cube blocks keep the existing greedy meshing path while non-full block models can emit explicit model quads.
- Update the voxel mesh binary contract so vertex positions can represent fractional in-block coordinates, not just integer cell boundaries.
- Preserve existing LOD/caching/compression behavior while ensuring cache keys account for model-shape asset inputs.
- Document the updated voxel payload contract and server/client responsibilities.

## Capabilities

### New Capabilities

- `cubyz-block-model-shapes`: Voxel mode renders supported Cubyz block model shapes using block asset model metadata and per-block data instead of assuming every non-air block occupies a full cube.

### Modified Capabilities

- `voxel-default-view`: Voxel mode's default visible terrain should reflect supported non-cube block geometry rather than rendering all visible blocks as full cubes.

## Impact

- Server voxel generation: `src/server/services/voxel-generator.ts`, `greedy-mesh.ts`, worker protocol, voxel cache versioning, and likely new block model asset parsing services.
- Client voxel decoding: `src/client/features/world-view/workers/voxel-mesh.worker.ts` and any types that assume integer-only quad coordinates.
- Startup composition: `src/server/index.ts` must build/pass block shape metadata alongside block colors.
- Asset parsing: layered Cubyz block definitions and `assets/*/models/*.obj` need to be read consistently with existing asset source behavior.
- Contracts/docs: update `docs/architecture-overview.md`, `docs/server-specification.md`, and `docs/client-specification.md` for the voxel binary payload and block-shape rendering behavior.
- Verification: run the default checks plus `npm run build` because this changes worker protocol and TypeScript boundaries.
