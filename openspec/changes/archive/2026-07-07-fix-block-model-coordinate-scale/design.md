## Context

The server builds block shape metadata at startup in `src/server/services/block-shape-table.ts` by reading layered block definitions, resolving `.model` references to OBJ assets, parsing OBJ vertices into block-local coordinates, and storing explicit model quads for the voxel generator. These quads are later emitted into `/api/voxels` for LOD 1 non-cube block models using the existing fixed-point vertex payload.

The current OBJ parser infers a coordinate scale with a broad heuristic: if any vertex coordinate has absolute value above `1.5`, the parser divides all coordinates by `16`; otherwise it leaves coordinates unchanged. That was intended to tolerate models authored in `0..16` voxel units, but it conflicts with Cubyz core assets that intentionally extend beyond one block. `cubyz:monstera` has OBJ bounds of roughly `1.8 x 1.8 x 1.6` blocks, so it crosses the heuristic threshold and is incorrectly shrunk to about one sixteenth of its authored size.

Cubyz's own block model loader reads OBJ coordinates directly through its coordinate-system conversion path. There is no adjacent model metadata for `cubyz:monstera` that requests a `16x` downscale, so the viewer should not infer that scale from the raw bounds alone.

## Goals / Non-Goals

**Goals:**

- Preserve Cubyz-authored OBJ block model coordinates for supported block models, including models with bounds larger than one block.
- Fix `cubyz:monstera` rendering so it appears at its intended multi-block visual size instead of as a tiny plant.
- Keep the existing voxel binary format and client worker decode path unchanged.
- Invalidate stale persisted voxel meshes generated with the old coordinate-scale interpretation.
- Document the revised server-side model coordinate behavior.

**Non-Goals:**

- Add a full Cubyz asset compiler or execute Zig model-loading code from the viewer.
- Add browser-side block model loading or client-side Cubyz OBJ parsing.
- Solve all possible third-party model authoring conventions without explicit metadata.
- Change rotation semantics, texture selection, transparency behavior, or higher-LOD model fallback behavior.

## Decisions

1. Preserve OBJ coordinates by default for Cubyz block models.

   The server should stop treating `maxAbs > 1.5` as sufficient evidence that a model is authored in `0..16` units. Current core Cubyz block model assets are authored in block-local units, and `monstera` is the only scanned core model above the existing threshold. Preserving the authored coordinates aligns the viewer with the game for oversized decorative models.

   Alternative considered: raise the threshold from `1.5` to a larger value such as `16`. This would fix `monstera`, but it keeps an undocumented heuristic in the critical path and can still misclassify future intentionally large models.

   Alternative considered: keep a smarter heuristic based on bounds near `16`. This could preserve compatibility with hypothetical `0..16` modded models, but there is no current metadata or known asset requiring it. Adding more heuristic behavior now risks another silent mismatch with Cubyz.

2. Keep the fix localized to block shape table OBJ parsing.

   Model coordinate scale is decided before voxel generation. Once quads enter the shape table, existing model rotation, semantic variant selection, fixed-point encoding, client decoding, bounds, and chunk-top-height paths can continue unchanged.

   Alternative considered: multiply selected models during voxel emission. That would fix visible size for specific blocks but would spread asset-normalization knowledge into `voxel-generator.ts` and make cache signatures harder to reason about.

3. Invalidate persisted voxel mesh caches by changing the shape interpretation signature and cache version.

   The old and new geometry use the same route and binary payload format but produce different vertex positions. Existing persisted cache entries must not be reused after the interpretation changes.

   Alternative considered: rely only on asset mtimes and sizes. That would not invalidate caches when assets are unchanged but interpretation code changes.

4. Prefer general behavior over a `cubyz:monstera` special case.

   The issue is not that monstera needs a custom multiplier; it is that the viewer overrides authored model coordinates with an unsafe global downscale. A general parser behavior change is easier to document and less likely to diverge again when Cubyz adds more oversized decorative models.

## Risks / Trade-offs

- Existing third-party models authored in `0..16` units could render sixteen times larger after removing or narrowing the heuristic -> Mitigate by documenting that supported Cubyz block OBJ coordinates are interpreted as block-local units unless explicit future metadata says otherwise.
- Oversized model bounds may extend outside the source voxel cell and affect visible geometry beyond adjacent cube boundaries -> This already matches the authored model and the fixed-point payload supports coordinates outside `0..1`; verify with `cubyz:monstera` and nearby terrain.
- Cache invalidation can be missed if only parsing code changes -> Mitigate by bumping the voxel generator cache version and shape interpretation signature/version together.
- Documentation may lag behind implementation -> Mitigate by updating `docs/server-specification.md` and `docs/architecture-overview.md` in the implementation task.

## Migration Plan

- Change the OBJ coordinate normalization in the block shape table.
- Bump the voxel cache version and shape signature/version so persisted meshes are regenerated.
- Run the default checks and typecheck after implementation.
- If the result causes unexpected oversized modded models, the rollback path is to restore explicit scale handling with a narrower, documented opt-in or detection rule rather than reintroducing the broad `maxAbs > 1.5` heuristic.

## Open Questions

- Should future support for `0..16` modded OBJ coordinates require explicit model metadata, or should the viewer eventually add a narrowly documented compatibility detector?
