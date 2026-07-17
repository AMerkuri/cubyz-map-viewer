## Why

Progressive voxel meshing renders complete base geometry before mesh-local emissive attributes, but the normal post-insert LOD reconciliation removes the fresh tile from fetch demand and cancels or rejects its queued enhancement. At midnight this leaves progressive mode unlit while one-phase mode correctly illuminates surrounding terrain; the runtime glow and high-quality point-light accents remain a separate, functioning presentation path.

## What Changes

- Preserve eligible progressive emissive enhancement work after its base tile becomes fresh, instead of treating the end of fetch demand as enhancement cancellation.
- Define enhancement validity in terms of the current loaded base tile, refresh version, base mesh identity, and loaded-tile retention lifecycle.
- Continue to cancel and reject enhancement work on refresh supersession, base replacement, unload, warm-cache movement, or other target invalidation.
- Add regression coverage for the complete runtime sequence from base insertion through post-insert LOD reconciliation and successful emissive attachment.
- Document the separate fetch-demand and enhancement-target lifecycle so future scheduler changes do not reintroduce the regression.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `client-emissive-bake-performance`: Progressive emissive enhancement must remain eligible and attach after its current base geometry becomes fresh.
- `client-voxel-work-scheduling`: Cancellation semantics must distinguish obsolete fetch/base work from valid enhancement work targeting a retained current base tile.

## Impact

- Client scene and scheduler integration in `src/client/features/world-view/components/World3DView.tsx`.
- Voxel request reconciliation and enhancement validation in `src/client/features/world-view/lib/voxel-requests.ts` and `voxel-runtime.ts`.
- Voxel scheduler lifecycle mechanics in `src/client/features/world-view/lib/voxel-work.ts` as needed to express phase-specific demand.
- Hermetic client pipeline and scheduler tests.
- `docs/architecture-overview.md` and `docs/client-specification.md`; no server route, payload, WebSocket, or persisted-data contract changes.
