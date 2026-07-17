## Why

Focused LOD 1 voxel detail can remain unsharp for minutes even when network fetches and server cache hits complete quickly, because strict coverage-first ordering can starve detail in the single-worker client pipeline and cumulative diagnostics obscure the current source of delay. The viewer needs bounded focus-detail latency, safe parallel mesh throughput, and less invalidation churn while preserving visible fallback coverage and stale-while-revalidate updates.

## What Changes

- Replace unconditional coverage-before-detail ordering with focus-aware urgency that protects visible holes while giving continuously demanded focus detail a bounded deadline.
- Retain the existing point-based voxel focus and fixed camera-motion detail debounce; pointer hover and tap positions do not drive LOD refinement.
- Add generation-scoped pipeline distributions, oldest-queue-age breakdowns, worker utilization, scene backlog, and focus deadline diagnostics.
- Replace the single active client mesh worker with a small adaptive pool whose dispatch reserves estimated expanded-output bytes and responds conservatively to interaction, frame-time, queue, scene, and memory health.
- Split base geometry readiness from optional emissive enhancement so useful geometry can become visible before expensive emissive baking, without allowing enhancement work to block urgent base work.
- Coalesce each received live-update batch into one invalidation per affected voxel key while preserving refresh-version rejection and stale visible geometry until atomic replacement.
- Reconcile client halo invalidation footprints with server invalidation behavior for all supported LODs.
- Update architecture and client documentation for the revised scheduler, worker protocol, diagnostics, and invalidation flow.
- Defer persistent derived-mesh storage to a separate change because it requires an encoding-independent mesh revision contract, storage quotas, and persistent cache lifecycle design.

## Capabilities

### New Capabilities
- `client-voxel-live-invalidation`: Coalesced, halo-correct client invalidation with version-safe stale-while-revalidate replacement.

### Modified Capabilities
- `client-voxel-work-scheduling`: Add bounded focus urgency, multi-worker admission with expanded-byte reservations, phase-aware scheduling, and generation-scoped diagnostics.
- `client-emissive-bake-performance`: Make emissive enhancement independently schedulable after base geometry becomes scene-ready.

## Impact

- Client scheduler and request flow in `src/client/features/world-view/lib/voxel-work.ts`, `voxel-requests.ts`, `voxel-runtime.ts`, and `voxel-lod.ts`.
- Scene integration in `World3DView.tsx` and `scene-runtime.ts`.
- Browser worker lifecycle and protocol in `voxel-mesh.worker.ts` and related shared types/builders.
- Live update processing in `live-updates.ts` and WebSocket scene subscription wiring.
- Debug statistics, graphics settings, and hermetic client mechanics tests.
- Runtime documentation in `docs/architecture-overview.md` and `docs/client-specification.md`.
- No HTTP payload, public server route, or WebSocket event-name change is required.
