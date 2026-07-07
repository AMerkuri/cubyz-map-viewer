## Why

Standing still at detailed voxel zoom can cause the loaded voxel region count to bounce between two values while the warm cache count moves in the opposite direction. This creates unnecessary scene churn and makes the debug stats report unstable even when no network, fetch, or mesh work is pending.

## What Changes

- Stabilize voxel LOD selection so an unchanged camera/view state converges to one resident voxel tile set instead of alternating between two sets.
- Prevent recently restored warm-cache voxel tiles from being immediately dropped on the next LOD pass when the camera has not moved.
- Preserve existing warm-cache reuse behavior for real camera movement, world updates, and stale voxel refreshes.
- Add focused diagnostics or tests around the reproduced loaded/warm-cache oscillation path where practical.

## Capabilities

### New Capabilities
- `voxel-lod-stability`: Defines expected stability for voxel LOD selection, loaded voxel residency, and warm-cache restoration while the camera is stationary.

### Modified Capabilities

## Impact

- Affects client-side voxel LOD selection and runtime cache behavior under `src/client/features/world-view/`.
- Primary areas are `voxel-lod.ts`, `voxel-runtime.ts`, `voxel-requests.ts`, `voxel-cache.ts`, and the `World3DView.tsx` integration points.
- No server API, WebSocket, binary payload, or shared client/server contract changes are expected.
- Documentation updates are not expected unless implementation changes runtime/debug behavior visible to contributors.
