## 1. Shape Metadata Foundation

- [x] 1.1 Extend block shape metadata types to represent semantic shape kinds beyond cube, air, and static model.
- [x] 1.2 Parse supported rotation semantic definitions from layered Cubyz block assets while preserving existing safe fallback diagnostics.
- [x] 1.3 Add semantic support/version inputs to the block shape signature used by voxel cache validity.
- [x] 1.4 Ensure voxel worker data can receive the extended shape metadata without changing unrelated route behavior.

## 2. Sub-Block Geometry

- [x] 2.1 Implement `cubyz:stairs` data decoding for 2x2x2 occupied sub-block masks.
- [x] 2.2 Generate visible fractional quads for partially occupied sub-block states at LOD 1.
- [x] 2.3 Preserve the standard cube fast path for fully occupied `cubyz:stairs` states where geometry is equivalent to a full cube.
- [x] 2.4 Apply conservative higher-LOD replacement or fallback behavior for `cubyz:stairs` semantic blocks.

## 3. Connectivity Geometry

- [x] 3.1 Implement `cubyz:fence` data decoding and generated variants for fences, walls, and bars.
- [x] 3.2 Emit center-post and connected-arm quads for `cubyz:fence` semantic blocks at LOD 1.
- [x] 3.3 Implement `cubyz:branch` data decoding for six-direction connection bits.
- [x] 3.4 Emit branch surface geometry for supported branch blocks at LOD 1.
- [x] 3.5 Add diagnostics for unsupported or malformed connectivity model data.

## 4. Attachment And Direction Variants

- [x] 4.1 Implement `cubyz:carpet` face attachment variant selection from block data.
- [x] 4.2 Implement `cubyz:sign` floor, ceiling, and side variant selection for signs and lanterns.
- [x] 4.3 Implement `cubyz:hanging` top/bottom variant selection for supported vine blocks.
- [x] 4.4 Implement selected `cubyz:direction` finite model variants for chain and cactus flower blocks.
- [x] 4.5 Ensure unsupported attachment/direction states fall back safely with diagnostics.

## 5. Voxel Generation Integration

- [x] 5.1 Route semantic shapes through voxel generation so model/sub-block quads are emitted once per visible block at LOD 1.
- [x] 5.2 Keep full-cube terrain blocks on the existing flood-fill and greedy-merge path.
- [x] 5.3 Ensure semantic blocks do not incorrectly occlude neighboring cube faces unless their generated geometry proves full boundary occupancy.
- [x] 5.4 Confirm existing fixed-point voxel vertex encoding represents all generated semantic geometry; if not, update the payload and decoder together.

## 6. Documentation

- [x] 6.1 Update `docs/architecture-overview.md` with the expanded server-side block shape semantic flow.
- [x] 6.2 Update `docs/server-specification.md` with supported rotation semantics, fallback behavior, LOD behavior, and cache validity rules.
- [x] 6.3 Update `docs/client-specification.md` if the voxel binary payload or client worker decode assumptions change.

## 7. Verification

- [x] 7.1 Run `npm run check`.
- [x] 7.2 Run `npm run check:knip`.
- [x] 7.3 Run `npm run typecheck`.
- [x] 7.4 Run `npm run build` because worker data, voxel generation, route payload assumptions, or TypeScript boundaries may change.
