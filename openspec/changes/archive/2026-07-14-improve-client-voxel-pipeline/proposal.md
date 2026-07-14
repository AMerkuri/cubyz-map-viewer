## Why

Client voxel loading can admit more fetched work than its single mesh worker and main-thread scene builder can consume, while obsolete jobs continue decoding and transferring expanded mesh output. At the same time, nearly radial fine-LOD selection retains costly detail outside the useful camera view, contributing to high loading latency and more than 1 GB of active voxel memory in representative scenes.

## What Changes

- Add explicit byte- and job-bounded backpressure between voxel fetching, worker meshing, and main-thread scene insertion.
- Add cooperative cancellation for queued and running mesh jobs so superseded camera demand and stale refresh versions stop before producing obsolete expanded output.
- Replace the weak behind-camera distance bias with a view-aware LOD heuristic that prioritizes projected, forward-visible detail while retaining coarser fallback coverage outside the view.
- Prioritize coverage work ahead of optional detail and make request priority account for view relevance, projected benefit, distance, and LOD.
- Extend client diagnostics to expose worker admission, queue wait, cancellation, discarded work, and end-to-visible timing needed to validate the redesign.
- Add hermetic client mechanics tests for bounded admission, cancellation races, view-aware selection, fallback continuity, and stationary convergence.
- Update the client runtime and architecture documentation to describe the revised loading flow and tuning controls.

## Capabilities

### New Capabilities
- `client-voxel-work-scheduling`: Defines bounded worker admission, cooperative job cancellation, coverage-first priority, and loading-pipeline diagnostics.

### Modified Capabilities
- `voxel-lod-stability`: Changes client LOD selection requirements so fine refinement accounts for camera view relevance while preserving stationary convergence, focus detail, and continuous coarser fallback coverage.

## Impact

- Affects client voxel request scheduling, worker protocol and worker execution, LOD selection, queued-output handling, debug settings, and HUD metrics under `src/client/features/world-view/` and `src/client/lib/world-view-debug.ts`.
- Adds or extends hermetic mechanics coverage under `test/core/` without requiring a browser, WebGL, running server, or real Cubyz save.
- Does not change `/api/voxels`, the binary voxel payload, server generation, or WebSocket event contracts.
- Requires updates to `docs/architecture-overview.md` and `docs/client-specification.md` because the client runtime flow and worker contract change.
