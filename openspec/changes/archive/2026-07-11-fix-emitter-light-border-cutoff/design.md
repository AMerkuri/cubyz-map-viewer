## Context

Emitted light is baked into per-vertex `emissiveLight` attributes inside the client voxel worker (`src/client/features/world-view/workers/voxel-mesh.worker.ts`). Each meshing job builds a spatial `EmitterLightGrid` from the payload's emitter records (own-region records plus server-injected neighbor "halo" records), then, for every mesh vertex, accumulates bounded contributions from nearby emitters. `cellSize` equals `VOXEL_EMITTED_LIGHT.radius` (12 world units).

A recent rewrite (part of the uncommitted `preserve-coarse-lod-light-energy` work) changed the candidate model:

- **Before:** grid-build inserted each emitter into its single center cell; `accumulateEmitterLight` probed the receiver vertex's cell plus its 26 neighbors (a 3×3×3 window). The grid was padded by one cell (`+2` extent, `minCell - 1` origin) so those neighbor probes stayed in bounds.
- **After:** grid-build inserts each emitter into every cell its radius overlaps; `accumulateEmitterLight` probes only the receiver vertex's single cell (`getEmitterGridCell(grid, cx, cy, cz)`), and the `+2`/`-1` padding was removed.

The single-cell probe is only correct if the set of cells an emitter is inserted into is a superset of the set of receiver cells that fall within the emitter's falloff radius. Two gaps break that invariant and produce hard, seam-aligned cutoffs:

1. **Radius asymmetry.** Insertion uses the raw `record.radius` (`voxel-mesh.worker.ts:1129-1135`), but falloff uses `grid.radius[i] = min(EMITTER_MAX_RADIUS, record.radius + quantizationPadding)` (`:1204-1207`). At LOD ≥ 16 the padded falloff radius exceeds the insertion footprint, so a vertex the falloff wants to reach may sit in a cell the emitter was never inserted into.
2. **No boundary slack + floor divergence.** Insertion cells are derived from `floor((record.x ± radius) / cellSize)`; the receiver cell is `floor(vertexX / cellSize)`. At a cell edge these can differ by one, and with zero padding and a single-cell probe there is no neighbor cell to recover the emitter. Because each region is meshed as an independent job whose grid is sized to that job's emitter set, the coverage gap manifests along region seams (where halo emitters live), reading as "light stops at the chunk border."

The server payload is correct: LOD 1 still emits own-region records plus halo records, and coarse LODs still carry representative power/footprint. This is a client bake correctness fix only.

## Goals / Non-Goals

**Goals:**
- Emitted light spreads continuously across emitter-grid cell boundaries and across voxel-region seams within the configured radius, with no straight-line cutoff.
- Grid-cell insertion coverage is always at least the falloff reach for the same emitter.
- Preserve the rewrite's performance characteristics: radius-overlap indexing, bounded candidates per vertex, and the broad-emitter fallback for pathologically large footprints.
- Keep unchanged LOD 1 detail behavior and the coarse-LOD power/footprint compensation, clamps, and budgets.

**Non-Goals:**
- No changes to server voxel generation, `/api/voxels` payload format, halo collection, emitter metadata encoding, or cache identity.
- No re-tuning of intensity, `powerGain`, `radiusEnergyAttenuation`, `maxContribution`, or quantization padding values (except where an insertion radius must reference the padded radius for coverage).
- No change to the shader or runtime point-light/glow-sprite accents.

## Decisions

### Decision 1: Insert emitters using the same (padded) radius used for falloff

Compute each emitter's `grid.radius[i]` (raw radius plus quantization padding, clamped to `EMITTER_MAX_RADIUS`) **before** deriving its grid-cell insertion bounds, and use that padded radius for both the bounding-box extent scan and the per-cell insertion loop. This guarantees insertion coverage ⊇ falloff reach, closing gap 1.

- **Alternative considered:** shrink the falloff radius to the raw radius. Rejected — the quantization padding exists to compensate for coarse-LOD center placement error; removing it would reintroduce coarse-LOD dimming the padding was added to fix.

### Decision 2: Add one cell of insertion margin to absorb floor divergence at cell edges

Expand each emitter's inserted cell bounds by one cell on every side (equivalently, insert into `[floor((x−r)/cs) − 1 .. floor((x+r)/cs) + 1]`), and restore a conditional receiver-side neighbor probe. Validation at the `640/5376` to `768/5376` LOD 1 seam showed matching halo records and nonzero border attributes, but the single-cell lookup still produced a visible cutoff. When the primary receiver cell has no exact-reach candidate, probe `[cx−1..cx+1] × [cy−1..cy+1] × [cz−1..cz+1]` with a stamped typed-array de-duplication buffer; ordinary lit cells retain the single-cell fast path. Expand conservative quad culling by the same one-cell margin.

- **Consequence for the dense-grid extent:** the grid bounding box (`minCellX..maxCellX`) and dense-allocation budget must account for the added margin so inserted cells are never dropped by the `denseCellIndex` bounds check. The receiver probe and culling scan use the same one-cell margin, while exact radius filtering and the bounded nearest-candidate cap retain the performance budget.

### Decision 3: Keep bounded per-vertex candidate selection, but ensure it never excludes a reachable emitter over an unreachable one

The rewrite selects the nearest `maxCandidatesPerVertex` emitters from the vertex cell. Because insertion slack also places non-reaching emitters in adjacent cells, the worker first rejects candidates outside their exact falloff sphere or blocked by their open-face mask, then applies the nearest-N selection. This guarantees a non-contributing slack candidate cannot crowd out a reachable halo emitter; any dropped candidate is farther than N kept reachable candidates and contributes negligible smoothstep falloff.

### Decision 4: Verify with the existing diagnostics rather than adding new ones

Use the existing `haloEmitters` debug toggle and emissive-bake bypass (`src/client/lib/world-view-debug.ts`) plus the emissive-phase metrics already emitted by the worker to confirm the seam is gone and candidate-visit cost stayed bounded. No new diagnostics are required.

## Risks / Trade-offs

- **Larger dense grid / more insertions per emitter** → The added margin and padded radius increase inserted cells per emitter and grid allocation. Mitigation: margin is a single cell; the existing `EMITTER_DENSE_GRID_MAX_CELLS` sparse fallback and `EMITTER_MAX_INDEX_CELLS` broad-emitter path already bound worst cases. Watch `gridBuildMs` in metrics.
- **Insertion-margin may not fully cover an exact floating-point edge case** → Mitigation: margin of one full cell exceeds any sub-cell `floor` divergence; if a residual seam remains in validation, fall back to Decision 2's alternative (a `[cx−1..cx+1]` receiver probe) which is provably complete.
- **Coarse-LOD footprint interactions** → Padded insertion radius slightly widens coarse-LOD coverage. Mitigation: falloff, `powerGain`, and `maxContribution` clamps are unchanged, so perceived brightness stays bounded; only discoverability improves.
- **Regression scope is a hot worker path** → Mitigation: change is localized to `buildEmitterLightGrid` and the `denseCellIndex` extent math; `accumulateEmitterLight` core weighting stays intact. Validate bake metrics before/after.

## Migration Plan

Client-only, no persisted state or contract change. Ship the worker fix; existing cached payloads remain valid because the payload format is unchanged. Rollback is reverting the worker diff. No server redeploy or cache invalidation needed.

## Open Questions

- Is a one-cell insertion margin sufficient at LOD 32 where quantization padding is largest, or should the margin be expressed in world units (`ceil(quantizationPadding / cellSize)`) instead of a fixed one cell? Resolve during validation against LOD 16/32 seam scenes.
