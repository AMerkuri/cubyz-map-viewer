## Context

The viewer uses worker-baked mesh-local emissive attributes as the primary
block-light path. The main thread additionally selects own-region emitters for
glow sprites and, at high quality, a bounded set of `PointLight` accents. The
server adds neighboring LOD 1 halo emitters to each payload so worker baking can
cross region seams.

Current runtime work precedes the frame-cap return, sprites are allocated per
decoded emitter, and worker candidate processing builds and fully sorts objects
per lit vertex. Halo collection already shares external-region parsing within a
job, but it repeats traversability interpretation and serial face awaits. Its
own-record-first 8,192-record cap can remove every relevant halo source.

## Goals / Non-Goals

**Goals:**
- Bound main-thread accent scene objects, materials, and selection work by the
  configured runtime budgets.
- Avoid block-light work on skipped frames while preserving mesh-emissive and
  accent transition behavior.
- Remove avoidable worker hot-path allocation while retaining exact bounded
  candidate selection order.
- Reuse halo traversability work without changing cell semantics or the binary
  record format.
- Retain boundary-relevant halo records under payload cap pressure, invalidate
  old persistent payloads, and validate seams systematically.

**Non-Goals:**
- Replace mesh-local emissive baking with dynamic Three.js point lighting.
- Increase glow or point-light budgets, or make point lights the primary voxel
  illumination path.
- Change `/api/voxels` compression, coordinate convention, or binary emitter
  record layout.
- Retune coarse LOD power, radius, or presentation gain.

## Decisions

### Decision: Gate runtime synchronization and updates by rendered frames

The animation loop will compute the effective cap before block-light runtime
work. On a skipped rAF tick it will return without region synchronization or
accent selection. A loaded-voxel revision, incremented for addition, removal,
and replacement, will avoid scanning an unchanged map on rendered frames.

The runtime will keep an inactive-accent state. On a transition to disabled or
daytime, it hides pooled sprites and point lights once; while inactive it sets
the mesh strength needed by the rendered frame but avoids flattening emitters.

Alternatives considered:
- Run only the strength-uniform update on skipped rAF ticks. Rejected because a
  skipped tick cannot produce a visible frame; the next rendered update is
  sufficient.
- Use tile count and key hashing as change detection. Rejected because a tile
  can replace its emitter array without changing keys or count.

### Decision: Use global reusable accent pools and deterministic top-K selection

The runtime will retain emitter metadata per loaded tile but own no tile sprite
groups. It will create up to `HIGH_GLOW_BUDGET` glow slots, each with a reusable
sprite and material, plus the existing point-light pool. On selection, slots
receive the nearest own emitters and unused slots are hidden.

Selection will use a bounded algorithm rather than a full sort. Its comparison
will use squared distance followed by a deterministic source-order tie-break.
Point lights remain optional Lambert accents: they dynamically affect voxel base
lighting but remain independent of the baked emissive attribute and uniform.

Alternatives considered:
- Keep invisible per-emitter sprites and only optimize sorting. Rejected because
  scene graph and material cost remains proportional to decoded emitters.
- Share one sprite material across every slot. Rejected because simultaneously
  visible sources require independent color and opacity values.

### Decision: Preserve worker bake output while using bounded primitive selection

The worker will retain the existing reusable candidate-index scratch array but
replace the mapped candidate-object, filter, full-sort, and slice chain with
primitive scratch state and bounded top-32 selection. Reachability filtering,
distance comparison, and emitter-index tie behavior remain unchanged.

Alternatives considered:
- Change candidate limit or falloff to reduce work. Rejected because it changes
  rendered light and belongs to visual tuning rather than a performance-safe
  refactor.
- Cache vertex results across quads. Rejected because position and normal vary,
  cache locality is uncertain, and the memory/lifecycle complexity is higher.

### Decision: Cache halo traversability with unified cell access

Halo collection will use a generation-local traversability cache layered on the
existing target/external chunk access. It will cache cell interpretation after
loading while preserving missing-chunk, out-of-range-Z, and block-shape rules.
Face checks may reuse cached values, but output record order remains
deterministic.

Alternatives considered:
- Cache external chunks only. Rejected because region parsing is already shared;
  the repeated per-cell interpretation is the remaining hot work.
- Treat missing or special cells as opaque for simpler caching. Rejected because
  it changes open-face behavior and can create light cutoffs.

### Decision: Reserve and rank halo records by receiving-boundary relevance

At cap pressure, selection will first protect a bounded halo allocation split
across the four horizontal receiving boundaries (`x-`, `x+`, `y-`, `y+`). A
corner candidate is eligible for each relevant edge but is emitted once; after
deduplication, unused edge allocation is filled by the next globally
boundary-relevant halo candidate. Within an edge, ranking favors smaller
distance to receiving geometry/boundary, then vertical relevance, followed by
the existing stable coordinate/color order. Remaining capacity is filled by the
documented deterministic own/halo fallback order.

The exact allocation constants will be calibrated against fixture density, but
each horizontal edge must receive a non-zero protected allocation when eligible
halo records exist. Any change to this selection policy increments
`VOXEL_GENERATOR_CACHE_VERSION`; wire layout remains unchanged.

Alternatives considered:
- Keep own-record-first sorting. Rejected because it can eliminate all halo
  sources under dense own-region content.
- Use one global halo reservation. Rejected because one busy edge can starve a
  source on another edge, and it gives no defined corner behavior.
- Encode more than 8,192 records. Rejected because it changes payload budgets
  and does not bound worker work.

## Risks / Trade-offs

- Bounded selection can alter equal-distance slot assignment → use stable
  secondary ordering and inspect camera-boundary behavior.
- A global pool can leave stale visual state after region unload → hide and
  recycle every slot not selected on each active selection pass.
- Primitive worker selection can accidentally change the top-32 set → preserve
  distance/index comparison and compare fixture output before and after.
- Traversability caching can change open-face behavior → validate missing,
  vertical-bound, transparent, model, and semantic-block cases against baseline.
- Per-edge halo allocation can reduce own-record retention → document the
  selection policy, validate dense scenes, and retain a deterministic fallback.
- Cache-version bumps invalidate stored payloads → expected one-time
  regeneration; retain rollback by reverting both code and version change.

## Migration Plan

1. Record idle/night runtime, worker, and cache-miss halo baselines with the
   existing diagnostics and fixed-LOD capture harness.
2. Implement and validate frame-gated runtime updates, change revisions, and
   transition-safe global accent pools.
3. Replace worker candidate allocation/sorting and compare fixed payload output
   and isolated captures with the baseline.
4. Add unified halo traversability caching, verify uncapped payload equivalence,
   then implement the boundary-aware capped-retention policy.
5. Increment the voxel generator cache version with the retention-policy change
   and run the seam matrix below and above cap pressure.
6. Update client, server, and architecture documentation with runtime behavior,
   selection policy, cache invalidation, and validation evidence.

Rollback reverts the relevant runtime, worker, or server change. A server
rollback must also restore the prior cache version or use a new version so
payloads are never interpreted under the wrong selection semantics.

## Open Questions

- What protected per-edge halo allocation best balances seam continuity against
  own-region detail in representative dense saves?
- Should runtime selection expose pool utilization and update duration in the
  existing debug HUD, or remain profiler-only until a regression is observed?
- What fixture mechanism most economically asserts decoded payload membership
  and non-zero baked light in a repository without a configured test runner?
