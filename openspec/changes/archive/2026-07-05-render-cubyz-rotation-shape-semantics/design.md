## Context

Voxel generation already preserves the full Cubyz block value as `typ | data << 16`, and the initial block-model work introduced a server-side block shape table that can resolve supported `.model` OBJ assets and emit fractional model quads for simple non-cube blocks. That support is intentionally limited to static/no-rotation models, planar rotations, and torch-style floor/side variants.

Cubyz core assets define many additional visible block shapes through rotation-mode code rather than through static OBJ files alone. The highest-impact missing categories are `cubyz:stairs` sub-block masks used by the chisel tool, `cubyz:fence` connectivity for fences/walls/bars, `cubyz:branch` procedural connected branch surfaces, and attachment-style modes such as `cubyz:carpet`, `cubyz:sign`, `cubyz:hanging`, and selected `cubyz:direction` models. These modes derive visible geometry from block `data`, neighboring blocks, or generated model variants.

The viewer should remain a map viewer, not a full Cubyz renderer. The implementation should port only geometry semantics needed to render saved voxel blocks accurately enough in voxel mode, preserve the existing cube fast path, and keep model/rotation support server-side so the client continues to consume compact mesh payloads.

## Goals / Non-Goals

**Goals:**

- Render chisel/sub-block states encoded by `cubyz:stairs` as partial 2x2x2 block geometry instead of full cubes.
- Render neighbor/data-driven connectivity for fences, walls, bars, and branches at LOD 1.
- Render attachment/data variants for carpets, signs, lanterns, vines, chain, and cactus flower where the semantics can be derived from block definitions plus block `data`.
- Keep the current greedy merged cube path for standard full cubes.
- Keep unsupported semantics safe and diagnosable rather than guessing incorrect geometry.
- Include rotation semantic inputs in voxel cache validity.
- Update server/architecture docs, and client docs if the voxel binary payload changes.

**Non-Goals:**

- Pixel-perfect parity with all Cubyz renderer behavior, lighting, UVs, texture-slot coloring, or collision/ray-intersection logic.
- Loading Cubyz block model assets in the browser.
- Full SBB/block-entity decoding for exact structure-building-block internals unless the needed shape is already represented by block `typ` and `data`.
- Rendering supported non-standard geometry at every higher LOD; higher LODs may continue to use conservative replacements/fallbacks.
- Replacing the existing `/api/voxels` route contract unless the current fractional quad payload proves insufficient.

## Decisions

1. Stage support by semantic family instead of trying to port every rotation mode at once.

   Start with `cubyz:stairs`, then `cubyz:fence`, then `cubyz:branch`, then attachment/data variants. This ordering covers the largest visible mismatch first and isolates distinct data dependencies: local block data, neighbor connectivity, procedural surface generation, and face attachment.

   Alternative considered: build a generic interpreter for Cubyz rotation modules. That would be more complete but too large for the TypeScript server and would blur the boundary between map viewer and game renderer.

2. Extend the block shape table with semantic descriptors and generated variants.

   Keep startup-time asset scanning, but represent more than `cube`, `air`, and static `model`. Shape metadata should include a semantic kind such as sub-block, fence-connectivity, branch-connectivity, face-attachment, sign-attachment, hanging-chain, or direction-variant. Where a mode has a small finite state space, precompute normalized quads once and reference them by block data during voxel generation.

   Alternative considered: compute all semantic geometry inside voxel generation. That keeps shape table smaller but repeats work across workers and regions and makes cache signatures harder to reason about.

3. Implement `cubyz:stairs` as direct 2x2x2 occupancy geometry.

   Interpret the lower 8 bits of block `data` as Cubyz does: each bit represents a removed sub-block, and unset bits represent filled half-cell octants. Emit visible quads for the occupied half-cells, merging within the block where simple, and treat the fully occupied state as a cube when possible.

   Alternative considered: approximate all stairs/chiseled blocks as bounding boxes. That would fix some half-block visuals but fail for diagonal/chiseled masks and compound shapes.

4. Derive connectivity mode state from saved block data first, with neighbor recomputation only where necessary.

   For `cubyz:fence`, saved data encodes horizontal connections. For `cubyz:branch`, saved data encodes six-direction connections plus a placed-by-human bit. The mesh generator should primarily trust saved `data`; if worlds are encountered where connection data is stale or missing, a later refinement can recompute from neighbors using Cubyz compatibility rules.

   Alternative considered: always recompute connectivity from neighboring blocks. That risks diverging from saved state and requires porting more of Cubyz's neighbor occlusion/replaceable/transparent logic before rendering any benefit.

5. Keep model quads colorized per block palette entry for this change.

   The existing voxel renderer colors quads by block palette index. Rotation semantic support should focus on geometry correctness and not require per-texture-slot sampling or multi-material mesh output.

   Alternative considered: port texture-slot colors while adding semantic shapes. That would improve visual fidelity but expands the scope into color-table and asset texture behavior.

6. Preserve the current fractional mesh payload unless new geometry exceeds its assumptions.

   The existing fixed-point vertex encoding can represent sub-block, fence, wall, sign, and branch coordinates. If implementation discovers that generated geometry requires a new payload field, bump the voxel generator cache version and update client/server docs in the same slice.

   Alternative considered: introduce a separate semantic instance payload. That could be compact for repeated variants but adds a second client rendering path and worker protocol complexity.

## Risks / Trade-offs

- [Cubyz rotation semantics diverge from the TypeScript port] -> Keep each semantic implementation narrowly based on observed `mods/cubyz/rotations/*.zig` behavior and verify against representative assets.
- [Neighbor-dependent shapes render with stale or incorrect connectivity] -> Trust saved data initially, log/inspect anomalies, and defer recomputation until there is evidence it is needed.
- [Sub-block geometry increases quad counts] -> Emit only visible faces, preserve full-cube greedy meshing, and restrict explicit semantic geometry to LOD 1 unless a safe LOD replacement exists.
- [SBB exactness requires skipped block entity data] -> Keep SBB/block-entity decoding out of scope for this change and document it as a separate future capability if typ/data cannot explain the shape.
- [Shape semantic changes reuse stale voxel caches] -> Include a semantic support version and relevant model/definition inputs in the block shape signature used by voxel cache keys.
- [Unsupported modes silently look wrong] -> Continue warning once per block ID/semantic and apply documented cube or air fallback behavior.

## Migration Plan

1. Extend shape metadata and diagnostics without changing the client payload.
2. Add `cubyz:stairs` sub-block generation and verify chisel/half-block examples.
3. Add `cubyz:fence` variants for fences, walls, and bars.
4. Add `cubyz:branch` procedural quads.
5. Add attachment/data variants for carpet, sign/lantern, hanging vine, and selected direction models.
6. Update voxel cache signatures and documentation before finishing implementation.

Rollback is straightforward: disable or revert semantic shape descriptors so affected blocks fall back to cube/air behavior. Voxel caches can be invalidated by the shape signature/cache version.

## Open Questions

- Are there saves where fence/branch connection data is absent or stale enough that the viewer must recompute it from neighbors?
- Does exact SBB/chisel rendering require block entity data that the current region parser skips, or are chisel-created shapes fully represented by `cubyz:stairs` data?
- Should `cubyz:log`, `cubyz:ore`, and `cubyz:decayable` be included in this implementation or left as visual refinements after the main non-cube geometry families?
- Should higher LODs use simplified semantic bounding geometry for walls/fences/branches, or continue using LOD replacements/fallbacks only?
