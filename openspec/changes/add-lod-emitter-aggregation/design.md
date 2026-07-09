## Context

The current server emits block-light records only for LOD 1 voxel payloads. When the viewer switches to coarser voxel LODs, important light sources disappear from both mesh-local illumination and runtime source accents. The desired behavior is not per-block fidelity at distance; it is preserving readable light cues with bounded representative records.

## Goals / Non-Goals

**Goals:**

- Generate conservative aggregated emitter records for LODs greater than 1.
- Preserve visually important strong or clustered light sources during LOD transitions.
- Bound payload size and runtime accent count for distant/coarse regions.
- Keep LOD 1 detailed emitter behavior unchanged.

**Non-Goals:**

- Render every fine emitter at every LOD.
- Add a separate light-index route.
- Guarantee exact energy conservation or Cubyz propagation parity.

## Decisions

### Decision: Aggregate emitters per coarse cell or cluster

For coarser LOD payloads, fine emitting blocks should be grouped into representative records. The representative color should preserve dominant hue and intensity enough for mesh-local lighting, while count caps prevent distant regions from producing excessive runtime accents.

Alternatives considered:

- Emit all fine records for all LODs. Rejected because it can explode payload and runtime work.
- Keep LODs greater than 1 dark. Rejected because light disappearance is a visible LOD artifact.

### Decision: Prefer strong and clustered sources first

Aggregation should prioritize lava/fire/glow clusters and stronger combined energy. Isolated weak torches may be omitted at very coarse LODs if needed to maintain budgets.

Alternatives considered:

- Uniform random sampling. Rejected because it is unstable and can drop important sources.
- Average every source equally. Rejected because it can muddy color and overrepresent weak lights.

### Decision: Treat aggregation as payload content

Because coarser LOD payloads will contain different emitter records than before, cache signatures and binary metrics should reflect the new content. The client worker should consume the records through the existing emitter pipeline where possible.

## Risks / Trade-offs

- Aggregation can make distant light look too large -> Use conservative intensity/radius scaling and validate against LOD transition scenes.
- Dominant color can be wrong for mixed clusters -> Use weighted RGB accumulation with clamps rather than naive averaging.
- Payload caches can reuse stale no-emitter coarse regions -> Bump relevant cache signature when coarser LOD emitter output changes.
- Runtime accents can clutter distant views -> Apply stricter accent budgets or source-size scaling for coarser LOD records.
