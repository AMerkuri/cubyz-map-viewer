## Why

Some Cubyz decorative and semantic voxel blocks are currently rendered with incorrect geometry in the map viewer. Texture-pile blocks such as red, dead, and yellow leaf piles fall back to full cubes, while sign floor and ceiling variants collapse Cubyz's 8-way orientation into four quarter-turn orientations.

## What Changes

- Support Cubyz `cubyz:texture_pile` block definitions that use plane-style model objects with finite texture states, so leaf piles and sibling texture-pile blocks render as non-cube decorative geometry instead of full blocks.
- Correct `cubyz:sign` floor and ceiling orientation handling so saved 8-way sign data produces 45-degree rotations matching Cubyz.
- Preserve existing side-sign attachment behavior while verifying side variants still map to the four Cubyz wall attachment states.
- Keep glass/translucent block rendering out of scope for this change.
- Invalidate stale persisted voxel mesh cache entries when the supported semantic shape behavior changes.
- Update server/shared documentation for the expanded shape semantics and cache behavior.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `cubyz-block-model-shapes`: Accept additional supported Cubyz model metadata forms needed by texture-pile plane blocks.
- `cubyz-rotation-shape-semantics`: Add `cubyz:texture_pile` semantic rendering and refine `cubyz:sign` orientation requirements.

## Impact

- Server voxel shape discovery in `src/server/services/block-shape-table.ts`.
- Server voxel mesh generation in `src/server/services/voxel-generator.ts`.
- Voxel cache invalidation via the block shape/semantic signature and cache versioning as needed.
- Documentation in `docs/architecture-overview.md` and `docs/server-specification.md` because the server-side voxel shape contract changes.
