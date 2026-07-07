## Why

The previous voxel performance work made the regression measurable and reduced some payload overhead, but idle measurements still show voxel loading and decode volume well above `1.1.0`: worker input averages about `1.3 MB` versus `585.8 KB`, and decoded memory remains dominated by LOD1 geometry. The current bottleneck is voxel loading, not idle FPS, so the next change should reduce decoded payload size and worker/main-thread decode cost while preserving recent visual correctness features.

## What Changes

- Replace explicit four-vertex encoding for ordinary greedy cube quads with a parametric greedy-rectangle representation that preserves identical world-space cube boundaries.
- Keep fractional/fixed-point vertex encoding for model and semantic geometry that cannot be represented as an axis-aligned greedy rectangle.
- Update the browser voxel worker to decode mixed parametric greedy quads and fractional model quads, ideally directly into quadrant output arrays after a counting pass to reduce transient allocations.
- Keep opaque and transparent voxel separation, AO behavior, and hover block identity intact across both payload paths.
- Extend diagnostics so the debug/service path makes greedy/model/transparent quad mix, raw decoded bytes, worker output bytes, and model-budget pressure visible enough to evaluate the loading bottleneck.
- Re-evaluate LOD1 model geometry budget after parametric greedy encoding, but do not use idle FPS as a success metric because the idle frame-rate cap intentionally affects it.

## Capabilities

### New Capabilities

### Modified Capabilities

- `cubyz-block-model-shapes`: Preserve model/semantic geometry while allowing ordinary greedy cube geometry to use a different compact payload path and exposing model-budget pressure.
- `transparent-voxel-rendering`: Preserve transparent face separation while changing the payload and worker decode path used to build opaque and transparent meshes.
- `voxel-hover-block-identity`: Preserve cursor hover block identity for both parametric greedy cube quads and fractional model/transparent quads.
- `voxel-lod-stability`: Keep stable loaded LOD residency measurable while optimizing per-tile payload/decode cost rather than relying on idle FPS.

## Impact

- Server voxel payload encoding: `src/server/services/greedy-mesh.ts`, `src/server/services/voxel-generator.ts`, `src/server/services/voxel-cache-version.ts`.
- Server service metrics and benchmark route: `src/server/services/voxel-mesh-service.ts`, `src/server/api/voxels.ts`, `src/server/workers/voxel-worker-protocol.ts`.
- Browser worker decode and output arrays: `src/client/features/world-view/workers/voxel-mesh.worker.ts`, `src/client/features/world-view/lib/types.ts`.
- Client debug stats and HUD: `src/client/features/world-view/lib/stats.ts`, `src/client/features/world-view/lib/memory.ts`, `src/client/features/world-controls/components/DebugStatsContent.tsx`.
- Documentation: update `docs/architecture-overview.md`, `docs/client-specification.md`, and `docs/server-specification.md` for binary payload, diagnostics, and cache-version contract changes.
- Verification must include `npm run check && npm run check:knip && npm run typecheck`, plus `npm run build` because worker decoding and route payload contracts change.
