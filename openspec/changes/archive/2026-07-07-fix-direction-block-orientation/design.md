## Context

`cubyz:direction` is a Cubyz rotation mode used by model blocks such as `cubyz:chain/iron`. Cubyz stores direction state in the block `data` field using the `Neighbor` enum order from `src/chunk.zig`: `0 = dirUp`, `1 = dirDown`, `2 = dirPosX`, `3 = dirNegX`, `4 = dirPosY`, and `5 = dirNegY`.

The game does not interpret those values as the viewer's current semantic face-transform order. Instead, `mods/cubyz/rotations/direction.zig` precomputes six centered model variants using matrix transforms:

- `0`: identity
- `1`: `rotationY(pi)`
- `2`: `rotationZ(-pi/2) * rotationX(-pi/2)`
- `3`: `rotationZ(pi/2) * rotationX(-pi/2)`
- `4`: `rotationX(-pi/2)`
- `5`: `rotationZ(pi) * rotationX(-pi/2)`

The viewer currently maps `cubyz:direction` data through `SemanticTransform` entries ordered as side faces first, then upright/ceiling. This causes vertical direction placements to render as horizontal side attachments in generated voxel meshes.

## Goals / Non-Goals

**Goals:**

- Render `cubyz:direction` model blocks with geometry equivalent to Cubyz's direction model variants for saved data values `0..5`.
- Keep the fix localized to server-side voxel model transform generation.
- Preserve the `/api/voxels` binary payload layout and client worker decoding.
- Ensure stale persisted voxel cache entries are not reused after the orientation behavior changes.
- Provide focused verification that `cubyz:direction` data maps to the expected transform sequence.

**Non-Goals:**

- Reworking generic semantic transforms for carpet, sign, hanging, fence, branch, stairs, or texture-pile behavior.
- Adding a full Zig runtime or asset compiler to execute Cubyz model code directly.
- Changing block palette parsing, region parsing, route payloads, or client rendering contracts.
- Implementing a general arbitrary matrix transform system unless the minimal direction fix naturally needs one.

## Decisions

1. Mirror Cubyz direction transforms explicitly in `voxel-generator.ts`.

   The implementation should introduce a direction-specific transform path for `cubyz:direction` rather than reordering the existing `SemanticTransform[]` list. Cubyz's direction variants include rotations around X, Y, and Z, while current semantic face transforms are hand-written coordinate remaps originally suited to attachment geometry. A direction-specific path reduces risk to other semantics.

   Alternative considered: reorder the existing transform array to `[none, ceiling, face-x+, face-x-, face-y+, face-y-]`. This is likely insufficient because Cubyz's `dirDown` transform is a centered Y rotation, not the same as the viewer's current `ceiling` remap, and the horizontal variants are produced by combined matrix rotations.

2. Keep model transforms centered around block center `(0.5, 0.5, 0.5)`.

   Cubyz applies `rotationMatrixTransform` by subtracting block center, multiplying the matrix, then adding block center. The viewer's direction transform should follow the same center-pivot behavior to preserve model bounds and placement.

   Alternative considered: perform axis swaps directly around the origin and patch offsets afterward. That is more error-prone for non-symmetric models and would be harder to compare with Cubyz's documented transform sequence.

3. Treat invalid direction data consistently with Cubyz.

   Cubyz uses `@min(block.data, 5)` when selecting direction model variants. The viewer should clamp direction data above `5` to the `5` transform instead of falling back to the upright variant.

   Alternative considered: default invalid values to identity. That would avoid extreme transforms but would diverge from the game's model selection.

4. Bump the shape semantic signature version when geometry changes.

   Direction transform output is part of persisted voxel mesh geometry. The existing shape semantic signature participates in voxel cache keys, so changing its version or signature input should invalidate old cache files without changing route behavior.

   Alternative considered: manually clearing cache directories. That is operationally fragile and not aligned with the existing cache validity design.

## Risks / Trade-offs

- Direction transform math could still differ in matrix multiplication order from Cubyz -> Mitigate by deriving each transform from the exact `direction.zig` matrix expressions and validating representative vertices for each data value.
- Exporting helper functions solely for tests could conflict with Knip expectations -> Mitigate by keeping helpers module-local if verification can exercise public generation paths, or by using narrowly scoped named exports only when imported by actual verification code.
- Existing cached meshes may hide the fix during manual testing -> Mitigate with semantic signature invalidation and, if needed, document that stale cache behavior indicates a missing signature bump.
- Chains are visually symmetric in some rotations, making manual verification ambiguous -> Mitigate by checking both `cubyz:chain/iron` at the reported coordinates and lower-level transform outputs for all six direction data values.
