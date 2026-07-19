## Why

After base-loading isolation, fixed target `2` reaches base-visible p95 near 8 seconds while adaptive mode remains at one worker and matches fixed target `1` near 40 seconds. Adaptive scale-up currently treats only visible-hole or deadline-promoted focus records as demand, so the initial urgent wave drains before the startup cooldown and the large remaining executable base backlog is classified as insufficient demand.

## What Changes

- Drive adaptive scale-up from bounded executable base backlog pressure rather than the tile-priority definition of urgent work.
- Include executable base count, oldest executable base age, and current worker saturation in the demand signal while continuing to exclude fresh, known-missing, retry-exhausted, and future retry-deadline records.
- Separate initial startup eligibility from post-change cooldown so a healthy fallback profile can reach two workers during the first sustained base wave.
- Preserve dispatch priority, device profile maxima, interaction response, frame-time, worker-duration, scene, reservation, and memory scale-down safeguards.
- Add adaptive transition and limiter-history diagnostics so final idle state does not erase the reason a target did or did not scale during loading.
- Compare adaptive behavior against fixed targets `1` and `2` on deterministic workloads and the established live camera, requiring adaptive to reach two and approach fixed-two base latency when health remains acceptable.
- Update architecture and client documentation; no worker protocol, server, payload, WebSocket, or persisted-settings change is required.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `client-voxel-work-scheduling`: Decouple adaptive concurrency pressure from scheduling urgency, permit startup scale-up under sustained executable base backlog, and make scale decisions observable over the load generation.

## Impact

- Adaptive controller and scheduler pressure summaries in `voxel-adaptive-workers.ts`, `voxel-work.ts`, and `World3DView.tsx`.
- Debug pipeline types, statistics aggregation, and HUD limiter presentation.
- Hermetic adaptive-controller and workload comparison tests plus live regression evidence.
- `docs/architecture-overview.md` and `docs/client-specification.md`.
- No change to tile priority ordering, maximum worker profiles, voxel binary contracts, or server behavior.
