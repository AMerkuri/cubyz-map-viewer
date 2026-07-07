## 1. Model Coordinate Interpretation

- [x] 1.1 Inspect `src/server/services/block-shape-table.ts` OBJ parsing and confirm the current `maxAbs > 1.5 ? 16 : 1` scale heuristic is the source of the `cubyz:monstera` shrinkage.
- [x] 1.2 Update supported block OBJ model parsing to preserve authored block-local coordinates by default, including coordinates outside the `0..1` range.
- [x] 1.3 Remove or narrow dead helper logic tied to the unsafe inferred `16x` downscale without changing unsupported-model fallback behavior.

## 2. Cache And Contract Updates

- [x] 2.1 Bump the block shape interpretation signature/version used by shape metadata so the semantic meaning of parsed model coordinates changes visibly in cache keys.
- [x] 2.2 Bump `VOXEL_GENERATOR_CACHE_VERSION` so persisted voxel mesh cache entries generated with the old coordinate interpretation are not reused.
- [x] 2.3 Update `docs/server-specification.md` to describe that supported OBJ block model vertices preserve authored block-local coordinates, including oversized model bounds.
- [x] 2.4 Update `docs/architecture-overview.md` to keep the server-generated voxel geometry contract in sync.

## 3. Verification

- [x] 3.1 Verify `cubyz:monstera.obj` parsed bounds remain approximately `1.8 x 1.8 x 1.6` block units instead of shrinking to roughly `0.11 x 0.11 x 0.10`.
- [x] 3.2 Run `npm run check`.
- [x] 3.3 Run `npm run check:knip`.
- [x] 3.4 Run `npm run typecheck`.
