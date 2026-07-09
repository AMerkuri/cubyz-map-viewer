## Why

LOD 1 voxel generation on large/deep worlds is dominated by neighboring-region halo emitter collection. The diagnostic matrix on `SEASON3` showed halo-enabled generation averaging roughly 8x slower than halo-disabled generation, while emissive attribute baking without halo stayed near baseline.

## What Changes

- Optimize LOD 1 halo emitter collection so normal block-light seams remain visually supported without brute-force repeated neighbor-region work.
- Reuse parsed external region data during a voxel generation job instead of reparsing the same neighboring `.region` files for halo probes, open-face checks, and boundary/ambient-occlusion checks.
- Add or extend server-side generation metrics so halo optimization can be verified with external region parse/cache counts and halo timing.
- Preserve the existing `/api/voxels` payload format and default lighting behavior.
- Keep diagnostic `halo=0` behavior available for comparison and cache-safe benchmarking.

## Capabilities

### New Capabilities

- `voxel-halo-emitter-performance`: Covers LOD 1 halo emitter collection performance, cache reuse, and verification metrics while preserving emitted-light behavior.

### Modified Capabilities

- `block-emissive-lighting`: Halo emitter collection must remain behaviorally compatible with current LOD 1 block-light payloads while using optimized neighbor-region access.
- `voxel-lighting-performance-diagnostics`: Diagnostics must expose enough server timing/cache data to verify halo collection improvements without relying only on external profiling.

## Impact

- Server voxel generation in `src/server/services/voxel-generator.ts`, especially `collectHaloEmitterRecords()`, `loadExternalChunk()`, and world-cell occupancy/traversability helpers.
- Voxel worker stats protocol in `src/server/workers/voxel-worker-protocol.ts` if new metrics cross worker boundaries.
- Voxel route headers or `/api/voxels/metrics` in `src/server/api/voxels.ts` and `src/server/services/voxel-mesh-service.ts` if new metrics are surfaced to benchmarks.
- Documentation in `docs/server-specification.md` and `docs/architecture-overview.md` if shared diagnostic fields or server runtime flow change.
- Verification should include the default checks plus `npm run build` because voxel worker boundaries and payload generation are involved.
