## Why

Light sources currently disappear on coarser voxel LODs because emitter records are emitted only for LOD 1 payloads. Coarser LODs need conservative aggregated light records so distant lit areas remain visually present without rendering every fine emitter.

## What Changes

- Generate bounded aggregated emitter records for coarser voxel LOD payloads.
- Coalesce nearby fine emitters into representative coarse records using conservative strength, color, and count caps.
- Prefer strong or clustered sources first so distant lava/fire/glow areas survive LOD transitions while isolated weak sources can be dropped.
- Preserve existing LOD 1 emitter detail.
- Update stats and docs so LOD-specific emitter behavior is understandable.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `block-emissive-lighting`: Coarser voxel LODs must receive conservative aggregated emitter records instead of always receiving zero emitter records.
- `voxel-lod-stability`: Voxel LOD transitions must preserve important emitted-light cues so light sources do not visibly vanish solely because geometry moved to a coarser LOD.

## Impact

- Server voxel generation, binary payload emitter record production, client block-light rendering, LOD visual behavior, and documentation.
- Payload cache signatures may need a bump if coarser LOD payload contents change while using existing cache keys.
- Build verification is required because voxel worker and server payload boundaries are involved.
