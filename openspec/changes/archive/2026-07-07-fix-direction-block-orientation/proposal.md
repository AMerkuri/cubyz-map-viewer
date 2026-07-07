## Why

Blocks using Cubyz rotation mode `cubyz:direction`, such as `cubyz:chain/iron`, render with incorrect orientation in the map viewer compared to the game. The viewer currently maps saved direction data to its own transform order instead of Cubyz's `Neighbor` enum and model rotation sequence, which makes vertical chain placements appear as horizontal or loose side segments.

## What Changes

- Align `cubyz:direction` model orientation in voxel meshes with Cubyz's saved `Neighbor` data order.
- Render direction data `0..5` using transforms equivalent to the game's `mods/cubyz/rotations/direction.zig` model variants.
- Preserve existing voxel mesh API shape and client worker binary contract.
- Add focused verification coverage for direction-model transform output where practical.

## Capabilities

### New Capabilities

### Modified Capabilities
- `cubyz-rotation-shape-semantics`: Direction-rotation semantic rendering must match Cubyz game orientation for saved block data values.

## Impact

- Affected server code: `src/server/services/voxel-generator.ts`, and possibly local helper tests or diagnostics around semantic model transforms.
- Affected behavior: `/api/voxels` mesh geometry for `cubyz:direction` blocks at LOD 1.
- No expected route payload, binary mesh format, WebSocket, dependency, or deployment changes.
- Documentation updates are not expected unless implementation changes the documented client/server contract.
