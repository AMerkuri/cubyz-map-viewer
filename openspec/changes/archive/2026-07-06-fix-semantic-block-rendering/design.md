## Context

Voxel block shape rendering is owned by the server. Startup shape discovery in `block-shape-table.ts` reads Cubyz block definitions and OBJ assets into a `BlockShapeTable`; `voxel-generator.ts` then uses that table plus each region block value's upper 16-bit `data` to emit explicit quads for supported LOD 1 non-cube geometry. The client receives already-shaped binary voxel quads and should not need Cubyz asset or rotation semantic knowledge for this change.

The current shape table supports string model references, `{ base, side }` torch-style model references, and semantic model maps for known rotations. Cubyz texture-pile blocks such as leaf piles and duckweed instead use `.rotation = "cubyz:texture_pile"` and `.model = .{ .model = "cubyz:plane", .states = 4 }`, so they are treated as unsupported and fall back to cubes. Cubyz signs use a 20-state data layout where floor and ceiling signs have eight 45-degree orientations and side signs have four wall attachments; the viewer currently maps floor and ceiling data through a quarter-turn transform, collapsing eight orientations into four.

## Goals / Non-Goals

**Goals:**

- Render supported `cubyz:texture_pile` blocks as plane/model geometry instead of full cubes at LOD 1.
- Parse the Cubyz model-object form used by texture piles without disrupting existing model reference parsing.
- Rotate floor and ceiling `cubyz:sign` variants in eight 45-degree steps matching Cubyz block data.
- Preserve side-sign face attachment mapping for the four Cubyz wall states and verify it against the current transform model.
- Invalidate stale voxel mesh cache entries when semantic geometry behavior changes.
- Update server/shared documentation for the expanded server-side voxel shape contract.

**Non-Goals:**

- Glass, transparency, or translucent block rendering changes.
- Client-side Cubyz asset loading or semantic decoding.
- Texture-atlas accurate per-state colors for texture piles; the viewer may continue using the block palette color for emitted quads.
- Higher LOD decorative detail beyond existing `lodReplacement` and fallback behavior.

## Decisions

### Treat `texture_pile` as a supported semantic shape

`cubyz:texture_pile` should be added to the supported semantic rotation set rather than hard-coding specific leaf pile block IDs. This matches the existing server design where Cubyz rotation metadata defines data-driven non-cube behavior, and it automatically covers sibling blocks such as `cubyz:duckweed`.

Alternative considered: special-case known leaf pile IDs. That would solve the observed blocks but would duplicate Cubyz metadata in viewer code and miss other texture-pile blocks.

### Parse `.model = .{ .model, .states }` minimally

The shape table should recognize the texture-pile model object by reading its `model` asset reference and `states` count. The geometry can use the referenced OBJ model quads; the state count is relevant for validating and clamping block data, cache signatures, and documenting that the shape follows finite Cubyz states.

Alternative considered: generalize all Cubyz model object parsing up front. That is broader than needed and risks implying support for model-object fields whose runtime semantics are still unknown.

### Keep texture-pile state visual output geometry-focused

Cubyz texture piles use block `data` to select a texture slot, not a different mesh shape. The viewer's voxel mesh format carries palette index and geometry, not Cubyz model texture slots, so this change should render the correct plane-sized shape while continuing to use the existing block color for that palette entry.

Alternative considered: extend the voxel payload to encode texture slots or per-state colors. That would be a larger client/server rendering contract change and is unnecessary to fix oversized cube geometry.

### Add angle-based model rotation for sign floor/ceiling variants

The existing `turns` value represents quarter turns. Sign floor and ceiling states need eighth turns, so sign semantic generation should use an angle-based transform or a dedicated eighth-turn transform path rather than overloading quarter-turn `turns`.

Alternative considered: map only every other sign state to quarter turns. That preserves current implementation shape but keeps the visible bug for diagonal signs.

### Use cache signature/version invalidation

Because persisted voxel meshes would otherwise contain old cube leaf piles or four-way sign geometry, semantic support versioning and/or the voxel cache version should change as part of implementation.

Alternative considered: rely only on source asset signatures. That would not invalidate meshes when interpretation code changes but asset files do not.

## Risks / Trade-offs

- Texture-pile color states are not texture-accurate -> Keep the requirement focused on geometry and existing palette color behavior.
- Angle-based rotation may expose winding or normal issues on OBJ quads -> Verify generated sign quads remain visible from expected camera angles and preserve existing binary quad encoding.
- Side sign transform could still be subtly offset or mirrored -> Include implementation verification against the Cubyz side state order `16..19` without expanding scope beyond signs.
- Cache invalidation may rebuild voxel meshes after deployment -> This is acceptable because stale visual geometry is worse than one-time regeneration.
- Supporting the model-object form too broadly could imply unsupported semantics -> Keep parsing intentionally narrow for `model` plus `states` where used by `texture_pile`.
