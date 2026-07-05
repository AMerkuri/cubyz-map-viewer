## Why

The voxel viewer now has an initial path for simple Cubyz OBJ-backed non-cube blocks, but many common Cubyz block types still render as full standard cubes because their visible geometry is selected by rotation mode, block data, neighbor connectivity, or chisel-style sub-block masks. This causes fences, walls, branches, carpets, signs, lanterns, vines, and chiseled half/sub-block terrain to appear materially different from the world players built.

## What Changes

- Add server-side support for additional Cubyz block shape semantics beyond static OBJ model references.
- Decode and render data-driven sub-block geometry for `cubyz:stairs`, including chisel-created 2x2x2 partial blocks and half-block-like states.
- Decode and render neighbor/data-driven connectivity models for `cubyz:fence` and `cubyz:branch`, covering fences, walls, bars, and branch families.
- Decode and render attachment/data model variants for `cubyz:carpet`, `cubyz:sign`, `cubyz:hanging`, and selected `cubyz:direction` model blocks.
- Preserve safe fallback behavior for unsupported rotation modes and states, with diagnostics that identify the block ID and unsupported semantic.
- Keep existing greedy meshing for full standard cubes and avoid broad client-side Cubyz asset loading.
- Update documentation for supported rotation semantics, higher-LOD behavior, and any voxel cache/signature impacts.

## Capabilities

### New Capabilities

- `cubyz-rotation-shape-semantics`: Covers voxel rendering of Cubyz blocks whose non-standard geometry depends on rotation modes, block `data`, neighbor connectivity, or chisel/sub-block masks rather than only static model OBJ geometry.

### Modified Capabilities

<!-- No existing main spec currently owns this behavior. -->

## Impact

- Server shape metadata: `src/server/services/block-shape-table.ts` will need richer shape/rotation metadata and generated model variants.
- Voxel generation: `src/server/services/voxel-generator.ts` and worker protocol inputs will need to emit data-driven model quads and sub-block quads while preserving cube greedy meshing.
- Cache validity: voxel cache/source signatures must account for shape semantic support and any generated model changes.
- Cubyz asset compatibility: implementation will reference core Cubyz rotation behavior from `mods/cubyz/rotations/*.zig` and block definitions under `assets/cubyz/blocks`.
- Documentation: update `docs/architecture-overview.md` and `docs/server-specification.md`; update `docs/client-specification.md` only if the binary voxel payload or client decode assumptions change.
