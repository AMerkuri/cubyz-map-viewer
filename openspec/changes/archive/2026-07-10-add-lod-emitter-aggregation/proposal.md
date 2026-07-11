## Why

Light sources currently disappear on coarser voxel LODs because emitter records are emitted only for LOD 1 payloads. Coarser LODs need conservative aggregated light records so distant lit areas remain visually present without rendering every fine emitter.

## What Changes

- Generate bounded aggregated emitter records for coarser voxel LOD payloads.
- Coalesce nearby emitters into representative coarse records using the existing emitter record layout first, with conservative color, count, and payload caps.
- Prefer strong or clustered sources first so distant lava/fire/glow areas survive LOD transitions while isolated weak sources can be dropped.
- Preserve existing LOD 1 emitter detail.
- Use the recently added halo-generation and client emissive-bake diagnostics to keep aggregation bounded by measured server generation cost, client bake cost, and output size.
- Update stats and docs so LOD-specific emitter behavior, cache validity, and benchmark interpretation are understandable.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `block-emissive-lighting`: Coarser voxel LODs must receive conservative aggregated emitter records instead of always receiving zero emitter records.
- `voxel-lod-stability`: Voxel LOD transitions must preserve important emitted-light cues so light sources do not visibly vanish solely because geometry moved to a coarser LOD.

## Impact

- Server voxel generation, binary payload emitter record production, voxel invalidation, client block-light rendering, LOD visual behavior, diagnostics, and documentation.
- Payload cache signatures need to distinguish coarser LOD aggregation behavior if payload contents change while using existing cache keys.
- Client emissive bake metrics should be used to verify aggregated records do not undo recent worker decode/output optimizations.
- Build verification is required because voxel worker and server payload boundaries are involved.
