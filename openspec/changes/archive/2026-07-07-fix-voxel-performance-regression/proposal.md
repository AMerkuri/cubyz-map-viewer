## Why

Master regressed voxel-mode FPS, stutter, and memory compared with `v1.1.0` at the same camera location, with LOD1 estimated memory roughly doubling and average voxel worker input growing from about 0.7 MB to 3.5 MB per sample. The regression appears tied to richer LOD1 voxel geometry, transparent/model rendering, and larger voxel payloads, so the viewer needs an explicit performance budget while preserving recent visual correctness work.

## What Changes

- Reduce voxel payload and retained geometry overhead for common cube/greedy faces while preserving fractional block model geometry where needed.
- Add diagnostics or metrics that distinguish cube face quads, model/semantic quads, transparent quads, decoded payload bytes, and retained geometry bytes.
- Revisit LOD1 modeled-block rendering so detailed model geometry does not unboundedly dominate memory and decode cost in dense regions.
- Correct voxel memory accounting so debug HUD estimates better reflect actual retained CPU-side and geometry attribute memory.
- Validate voxel LOD selection changes against the regression location so stabilization does not accidentally retain or select too much LOD1 detail.
- Preserve existing visual features: transparent voxels, block hover identity, Cubyz model/semantic shapes, and stable LOD selection.

## Capabilities

### New Capabilities

### Modified Capabilities

- `cubyz-block-model-shapes`: Add performance constraints for LOD1 model/semantic shape emission so detailed block shapes remain bounded in memory and decode cost.
- `transparent-voxel-rendering`: Add performance constraints for transparent voxel geometry separation and memory accounting.
- `voxel-hover-block-identity`: Preserve hover block identity while allowing payload/retention optimizations for palette index data.
- `voxel-lod-stability`: Ensure LOD stabilization does not increase loaded LOD1 detail beyond budget at stable camera positions.

## Impact

- Client voxel worker and mesh builder: `src/client/features/world-view/workers/voxel-mesh.worker.ts`, `src/client/features/world-view/lib/voxel-builders.ts`, `src/client/features/world-view/lib/memory.ts`, `src/client/features/world-view/lib/stats.ts`.
- Client LOD selection and runtime: `src/client/features/world-view/lib/voxel-lod.ts`, `src/client/features/world-view/lib/voxel-runtime.ts`, and `World3DView.tsx` integration points.
- Server voxel generation and wire format: `src/server/services/voxel-generator.ts`, `src/server/services/greedy-mesh.ts`, `src/server/services/voxel-mesh-service.ts`, and voxel worker protocol files.
- Documentation must be updated if the voxel wire format, debug metrics, or client/server payload contract changes.
- Verification should include `npm run check && npm run check:knip && npm run typecheck`, plus `npm run build` for worker and route payload boundary changes.
