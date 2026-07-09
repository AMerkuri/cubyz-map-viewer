## Why

The mesh-local block-lighting change made LOD 1 voxel payload generation and client loading significantly slower, but the current stats do not isolate server halo-emitter cost from client emissive-attribute cost. We need a small diagnostic experiment matrix before choosing an optimization path, so we avoid guessing whether to tune server payload generation, worker light baking, geometry representation, or all of them.

## What Changes

- Add a temporary, explicit diagnostic matrix for voxel lighting cost isolation with four modes: current behavior, halo disabled, emissive attribute disabled, and both disabled.
- Expose enough server and client metrics to compare halo collection/generation cost against worker emissive bake/output cost on the same scene.
- Keep the experiment bounded to debugging and measurement; it must not change default production visual behavior.
- Document how to run and interpret the matrix so the result can guide a later optimization change.

## Capabilities

### New Capabilities

- `voxel-lighting-performance-diagnostics`: Covers debug-only controls and metrics for isolating server halo-emitter cost from client mesh-local emissive-attribute cost.

### Modified Capabilities

- `block-emissive-lighting`: Clarifies that debug diagnostics may disable halo emitters or emissive mesh attributes for measurement while preserving the default emitted-light presentation.

## Impact

- Server voxel generation metrics in `src/server/services/voxel-generator.ts`, worker protocol/metrics in `src/server/workers/`, and `VoxelMeshService` response/debug metrics if needed.
- Client voxel worker timing/output metrics in `src/client/features/world-view/workers/voxel-mesh.worker.ts`.
- Client debug settings and HUD stats in `src/client/lib/world-view-debug.ts` and `src/client/features/world-controls/components/DebugStatsContent.tsx`.
- Documentation in `docs/client-specification.md`, `docs/server-specification.md`, and possibly `docs/architecture-overview.md` if diagnostics alter the documented runtime flow or shared debug contract.
