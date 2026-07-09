## Why

The voxel-lighting diagnostic matrix exposed inconsistent server metrics: halo timing appears to use the wrong unit or scope, and server run time changes suggest cached and uncached payloads are being averaged together. We need trustworthy timing and cache-hit/cache-miss counters before using the matrix to decide whether to optimize server halo collection, client emissive baking, or cache behavior.

## What Changes

- Normalize server halo timing to the same unit and request scope as other voxel benchmark timings.
- Add voxel benchmark cache-hit and cache-miss counters so diagnostic results can distinguish cold generation from warm cache serving.
- Separate or label cold and warm benchmark samples so matrix cells are comparable instead of mixing different cache states into one average.
- Surface the new cache and timing fields in the debug stats UI without changing default voxel rendering behavior.
- Document how to interpret halo timing and cache counters when running the diagnostic matrix.

## Capabilities

### New Capabilities

- `voxel-benchmark-cache-timing`: Covers accurate voxel benchmark timing units, cache hit/miss accounting, and cold-versus-warm diagnostic interpretation.

### Modified Capabilities

## Impact

- Server voxel generation and cache metrics in `src/server/services/voxel-generator.ts`, `src/server/services/voxel-mesh-service.ts`, and related worker protocol/types if timing fields cross process boundaries.
- HTTP response debug metadata or voxel benchmark sample collection for cache hit/miss reporting.
- Client benchmark aggregation and debug HUD rendering in `src/client/features/world-view/` and `src/client/features/world-controls/components/DebugStatsContent.tsx`.
- Documentation in `docs/client-specification.md`, `docs/server-specification.md`, and `docs/architecture-overview.md` if the fields become part of the documented debug contract.
