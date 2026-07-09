## 1. Server Timing And Cache Classification

- [x] 1.1 Audit `voxel-generator`, voxel worker protocol, and `VoxelMeshService` to find where halo timing changes unit or scope before reaching `/api/voxels`.
- [x] 1.2 Normalize halo timing so generated responses report milliseconds comparable to `X-Voxel-Run-Ms` and halo-disabled generation reports `0` or absent timing without stale values.
- [x] 1.3 Add explicit cache classification to voxel response metrics, distinguishing generated worker responses from in-memory or persistent cache responses.
- [x] 1.4 Expose cache classification through `/api/voxels` response headers or existing debug metadata without bypassing `VoxelMeshService`.
- [x] 1.5 Ensure cached responses do not present cached-generation halo timing as current-request halo work unless the field is clearly labeled as cached-generation metadata.

## 2. Client Benchmark Aggregation

- [x] 2.1 Read cache classification from voxel responses in `voxel-requests` and include it in worker benchmark samples.
- [x] 2.2 Extend worker/client benchmark types to carry cache classification without breaking samples from older or missing metadata.
- [x] 2.3 Track cache-hit, cache-miss, and unknown sample counts in the voxel benchmark aggregation.
- [x] 2.4 Reset or separate cache counters together with existing diagnostic matrix benchmark resets.
- [x] 2.5 If minimal, add cold-only and warm-only server timing averages; otherwise keep existing averages and show hit/miss counts clearly beside them.

## 3. Debug UI And Documentation

- [x] 3.1 Update `DebugStatsContent` to display cache-hit/cache-miss/unknown counts and clarify whether server halo timing represents current generation or cached metadata.
- [x] 3.2 Update `docs/server-specification.md` with voxel benchmark timing units, cache classification headers or metadata, and interpretation of cached halo timing.
- [x] 3.3 Update `docs/client-specification.md` with benchmark cache counters and cold-versus-warm diagnostic interpretation.
- [x] 3.4 Update `docs/architecture-overview.md` if the cache classification fields are part of the documented client/server debug contract.

## 4. Verification

- [x] 4.1 Run `npm run check`.
- [x] 4.2 Run `npm run check:knip`.
- [x] 4.3 Run `npm run typecheck`.
- [x] 4.4 Run `npm run build` because this touches route payload/debug headers, worker benchmark types, and client/server TypeScript boundaries.
- [x] 4.5 Re-run at least one cold and one warm diagnostic matrix cell and confirm halo timing is plausible relative to server run timing and cache hit/miss counters explain the sample mix.
