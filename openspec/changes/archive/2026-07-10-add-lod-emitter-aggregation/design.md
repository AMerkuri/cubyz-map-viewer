## Context

The current server emits block-light records only for LOD 1 voxel payloads. When the viewer switches to coarser voxel LODs, important light sources disappear from both mesh-local illumination and runtime source accents. The desired behavior is not per-block fidelity at distance; it is preserving readable light cues with bounded representative records.

Recent optimization work changed the constraints for this change. LOD 1 halo emitter collection now reuses external region data and exposes halo/cache metrics, while the client worker now uses optimized emissive bake structures, conservative quad culling, compact normalized emissive attributes, and benchmark phase metrics. Coarser LOD aggregation should build on those optimizations instead of reintroducing excessive server generation, client bake, or output-size cost.

## Goals / Non-Goals

**Goals:**

- Generate conservative aggregated emitter records for LODs greater than 1.
- Preserve visually important strong or clustered light sources during LOD transitions.
- Bound payload size, server generation work, client emissive bake work, and runtime accent count for distant/coarse regions.
- Keep LOD 1 detailed emitter behavior unchanged.
- Prefer the existing binary emitter record layout for the first implementation so the client worker and shader contract remain stable.

**Non-Goals:**

- Render every fine emitter at every LOD.
- Add a separate light-index route.
- Guarantee exact energy conservation or Cubyz propagation parity.
- Add radius, intensity, or cluster-count fields to the binary emitter layout in the first pass.

## Decisions

### Decision: Aggregate emitters per coarse cell or cluster

For coarser LOD payloads, emitting blocks should be grouped into representative records. The representative color should preserve dominant hue and intensity enough for mesh-local lighting, while count caps prevent distant regions from producing excessive runtime accents and client emissive bake work.

The first implementation should encode representative sources using the existing emitter record layout (`x`, `y`, `z`, RGB, flags). If that cannot preserve distant cues well enough, a later change can add explicit radius/intensity/count metadata with a binary payload version bump.

Alternatives considered:

- Emit all fine records for all LODs. Rejected because it can explode payload and runtime work.
- Keep LODs greater than 1 dark. Rejected because light disappearance is a visible LOD artifact.
- Add new radius/intensity/count fields immediately. Rejected for the first pass because it expands the client/server binary contract before validating whether representative records are enough.

### Decision: Prefer same-LOD source data first, with bounded LOD 1 source fallback if needed

Aggregation should first try to derive coarser LOD representatives from the source data already loaded for the coarser payload. This keeps generation local, cache signatures simple, and server cost predictable. If same-LOD source data lacks enough emitter fidelity to preserve important cues, the implementation can add a bounded LOD 1 source scan or index-backed lookup as a follow-up within the same aggregation policy.

Alternatives considered:

- Always scan LOD 1 source data for every coarser payload. Rejected as the default because it can widen generation and invalidation cost before proving same-LOD data is insufficient.
- Use only mesh traversal records. Rejected as the sole strategy because important emitters hidden by coarse geometry or traversal choices may disappear.

### Decision: Prefer strong and clustered sources first

Aggregation should prioritize lava/fire/glow clusters and stronger combined energy. Isolated weak torches may be omitted at very coarse LODs if needed to maintain budgets.

Alternatives considered:

- Uniform random sampling. Rejected because it is unstable and can drop important sources.
- Average every source equally. Rejected because it can muddy color and overrepresent weak lights.

### Decision: Treat aggregation as payload content

Because coarser LOD payloads will contain different emitter records than before, cache signatures and binary metrics should reflect the new content. The client worker should consume the records through the optimized emitter pipeline where possible, including compact normalized emissive attributes and emissive phase metrics.

Aggregation threshold changes, source-data strategy changes, and any future emitter binary layout changes must invalidate stale persisted coarser LOD payloads.

### Decision: Verify aggregation against recent server and client diagnostics

Implementation should use existing diagnostics to verify that coarser emitter records preserve cues without undoing recent performance wins. Server-side metrics should distinguish detailed and aggregated emitter counts when useful. Client-side benchmarks should monitor emissive bytes, emissive grid/build time, emissive bake time, and quads evaluated/culled for coarser LOD payloads.

Alternatives considered:

- Verify only by visual inspection. Rejected because aggregation can look acceptable in one scene while causing excessive worker output or bake time elsewhere.

## Risks / Trade-offs

- Aggregation can make distant light look too large -> Use conservative intensity/radius scaling and validate against LOD transition scenes.
- Dominant color can be wrong for mixed clusters -> Use weighted RGB accumulation with clamps rather than naive averaging.
- Payload caches can reuse stale no-emitter coarse regions -> Bump relevant cache signature when coarser LOD emitter output changes.
- Runtime accents can clutter distant views -> Apply stricter accent budgets or source-size scaling for coarser LOD records.
- Coarser records can increase client emissive bake cost -> Use the optimized bake metrics and strict record caps to bound emissive bytes and bake time.
- Neighbor/source dependencies can make invalidation incomplete -> Update voxel invalidation expansion if aggregation uses neighboring or finer source regions.
