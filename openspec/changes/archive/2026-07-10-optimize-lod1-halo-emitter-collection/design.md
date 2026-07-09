## Context

LOD 1 voxel payloads include own-region emitter records plus neighboring halo emitter records so block-light cues remain stable across region boundaries. The current halo collection path runs after visible mesh generation and scans a 12-cell perimeter ring around the 128x128 region across the visible vertical face span plus radius. On deep or mountainous saves, that vertical span can cover many sparse `.region` files.

Recent `SEASON3` diagnostics showed halo-enabled LOD 1 generation averaging roughly `93s` in a partial run versus roughly `11s` with halo disabled. The same benchmark showed emissive attribute baking without halo near baseline, so the first optimization target is server halo collection.

The current implementation also caches own-column parsed regions per generation job, but external chunk access reparses neighboring region files through `loadExternalChunk()`. Halo scanning and open-face checks can therefore repeat expensive parse/decompression work for the same external `.region` files.

## Goals / Non-Goals

**Goals:**

- Reduce LOD 1 halo-enabled voxel generation time on large/deep worlds.
- Preserve default block-light behavior and the existing binary voxel payload format.
- Avoid broad architectural changes before proving the minimal optimization works.
- Expose enough server metrics to compare external region parse/cache behavior before and after the change.
- Keep diagnostic `halo=0` behavior available for benchmark isolation.

**Non-Goals:**

- Change emitted-light radius, colors, budgets, or client visual tuning.
- Implement coarser LOD emitter aggregation.
- Add a persistent global emitter index or new public route in the first pass.
- Change `/api/voxels` compression requirements or binary layout.

## Decisions

### Decision: Start with generation-local external region caching

The first optimization should add a generation-local cache for parsed external region files keyed by normalized region coordinates and region world Z. `loadExternalChunk()` should select chunks from cached parsed `RegionData`, matching the existing own-column `regionLoaders` pattern.

This preserves behavior because it changes how neighbor data is loaded, not which cells are scanned or which records are emitted.

Alternatives considered:

- Build a persistent emitter index first. Rejected for the first pass because it adds invalidation, memory, and cache-signature complexity before measuring the simpler parse-reuse win.
- Disable halo emitters by default. Rejected because that removes seam lighting behavior and changes visuals.
- Reduce halo radius. Rejected because it changes lighting semantics and may hide the root performance waste.

### Decision: Share external chunk access with halo open-face checks

Halo collection should use the same external-region cache for both direct candidate cell reads and open-face traversability checks. The current `collectHaloEmitterRecords()` has a local chunk promise cache, but `getEmitterOpenFaces()` calls `isTraversableCellWorld()`, which can route back through uncached external chunk loading.

The optimized path should avoid parallel caches that disagree or miss each other. A single generation-local external region loader is easier to reason about and should benefit boundary face generation, ambient occlusion, halo scanning, and halo open-face checks.

Alternatives considered:

- Keep a halo-only chunk cache. Rejected because it does not help non-halo external accesses and can still miss repeated region parses from helper calls.
- Cache only boolean traversability. Rejected as insufficient because direct block reads still need chunk data and future metrics need region-load visibility.

### Decision: Add metrics for external region loading behavior

Existing metrics show total run time and halo phase time. The optimization should also report coarse external-region load behavior, such as parse attempts, cache hits, missing files, and optionally halo-scanned candidate counts. These metrics may appear in worker stats and `/api/voxels/metrics`; if exposed through headers or debug HUD, docs must be updated.

Alternatives considered:

- Rely only on `haloMs`. Rejected because it confirms elapsed time but not whether repeated parsing was fixed.
- Add detailed per-file tracing. Rejected because it can be noisy and expensive in normal debug sessions.

### Decision: Defer scan-shape changes until after parse reuse is measured

The current scan shape may still be too expensive after region parse reuse because it walks every perimeter cell across a tall Z range. However, changing to emitter-first scanning, chunk palette prefilters, or persistent sidecar indexes changes more behavior and deserves a second step if metrics show parse reuse is not enough.

Alternatives considered:

- Immediately rewrite halo collection to scan emitters instead of cells. Deferred because it is likely correct but larger, and it may change record ordering, candidate filtering, and open-face timing.
- Add a persistent sidecar index. Deferred because invalidation and cross-worker sharing need separate design.

## Risks / Trade-offs

- External region cache increases per-job memory while generation is active -> Keep cache generation-local and bounded by the regions naturally touched by the existing scan.
- Metrics can become noisy or expose too many headers -> Prefer aggregate counters and document only stable debug fields.
- Parse reuse may not fully solve tall-column scan cost -> Use the added metrics to decide whether a follow-up emitter-first scan or index is needed.
- Behavior-preserving cache changes can still alter timing/order-dependent bugs -> Preserve sorted emitter output and existing cache keys unless payload content changes.
- Worker memory pressure may increase when several workers cache neighbor regions simultaneously -> Validate with the existing reduced-scope `SEASON3` benchmark and watch process memory.

## Migration Plan

1. Add generation-local external region cache and wire all external chunk access through it.
2. Add aggregate metrics for external region cache behavior and halo candidate/scanned work as needed.
3. Keep existing persistent voxel cache identity unless payload content changes.
4. Run normal verification plus `npm run build` because worker stats/protocol may change.
5. Re-run the reduced-scope `SEASON3` benchmark comparing halo off/on against the previous baseline.
6. Rollback by removing the external cache and metrics if memory use or behavior regresses.

## Open Questions

- Which external-region counters should be promoted to route headers versus kept only in `/api/voxels/metrics`?
- Should the implementation add a traversability cache for `isTraversableCellWorld()` in the same change, or keep the first pass strictly to parsed-region reuse?
- What target improvement should gate success: absolute halo `runMs`, halo/on-to-off ratio, or external region parse reduction?
