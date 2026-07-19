## Why

Cached emissive discovery and two client workers reduced the fixed-camera load from 107 seconds to 26 seconds, but optional enhancement still raises base-visible p95 from the emissive-off baseline of 15 seconds to 26 seconds because retained enhancement input competes with base fetch admission and workers. Adaptive mode also remains at one worker under otherwise healthy conditions unless operators manually edit local storage to raise the output budget and force a target, while current diagnostics hide selection-to-fetch delay and misreport some queued and output state.

## What Changes

- Treat executable base demand across selection, fetch admission, active fetch, compact input, worker execution, and scene-ready insertion as one protected base-loading lifecycle.
- Reserve compact-input job and byte capacity for base responses so retained optional enhancement cannot close the base fetch-admission gate.
- Defer enhancement dispatch while executable base work remains anywhere in the protected lifecycle, allowing available workers to converge base geometry first and enhancement to use capacity afterward.
- Correct adaptive worker inputs and expanded-output reservation behavior so a healthy desktop or fallback profile can reach two workers without manual local-storage edits while retaining frame, scene, and memory safeguards.
- Fix MiB debug-control conversion so expanded-output and compact-input memory limits can be configured accurately through the web client.
- Add selection-to-fetch-start timing, base/enhancement output-byte separation, current adaptive limiter state, and executable queue diagnostics that exclude known-missing or permanently ineligible demand.
- Verify that concurrent loading converges the same demanded tile set without losing a region through cancellation or admission races.
- Update architecture and client documentation; no server route, payload, WebSocket, or persistent-cache contract changes are required.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `client-voxel-work-scheduling`: Protect base work across all client pipeline stages, reserve base admission capacity, make healthy two-worker scaling reachable, preserve deterministic convergence, and expose complete admission and limiter diagnostics.
- `client-emissive-bake-performance`: Strengthen progressive behavior so optional enhancement cannot delay executable base work merely because no base compact buffer is ready at one instant.

## Impact

- Client scheduler, request admission, output estimation, worker-pool control, and diagnostics in `voxel-work.ts`, `voxel-runtime.ts`, `voxel-requests.ts`, `voxel-adaptive-workers.ts`, and `World3DView.tsx`.
- Debug settings definitions and controls in `world-view-debug.ts` and `MapDebugParameters.tsx`.
- Worker benchmark aggregation and HUD output-byte presentation.
- Hermetic scheduler, admission, adaptive-controller, progressive pipeline, and concurrency convergence tests.
- `docs/architecture-overview.md` and `docs/client-specification.md`.
- No server, binary voxel payload, shader, WebSocket event, or persisted world-data migration.
