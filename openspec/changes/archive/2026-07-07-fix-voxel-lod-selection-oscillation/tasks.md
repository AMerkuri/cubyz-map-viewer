## 1. Diagnose Selection Churn

- [x] 1.1 Reproduce the stationary oscillation at `?x=565&y=5547&z=35&zoom=90&theta=-91&phi=27&focus=exact` and confirm the 183/197 loaded-count and 14/0 warm-cache pattern after loading settles.
- [x] 1.2 Add temporary local diagnostics or use debugger inspection to capture the exact voxel keys restored from warm cache and unloaded on the following LOD pass.
- [x] 1.3 Trace the oscillating keys through `runVoxelLodSelection`, including `visibleQuadrantMasks`, `coverageVoxelRequests`, `detailVoxelRequests`, `retainedLoadedVoxelKeys`, and `requestedVoxelRequests`.
- [x] 1.4 Identify whether the exclusion is caused by parent/child fallback, detail request commitment, quadrant visibility, stale/missing state, or active request synchronization.

## 2. Stabilize Voxel LOD Residency

- [x] 2.1 Implement the smallest fix at the voxel selection/runtime boundary that prevents unchanged-camera request sets from alternating between the same two tile groups.
- [x] 2.2 Ensure warm-cache restored tiles are not immediately unloaded on the next stable LOD pass unless they are consistently excluded, stale, invalidated, outside allowed LOD, or evicted by memory limits.
- [x] 2.3 Preserve parent/child fallback coverage so missing or unavailable finer regions still render eligible coarser coverage.
- [x] 2.4 Preserve stale voxel refresh behavior and warm-cache memory limit eviction.
- [x] 2.5 Remove temporary diagnostics or gate any retained diagnostics so normal runtime output remains clean.

## 3. Verification

- [x] 3.1 Verify in the browser that the reproduced stationary URL converges to a stable loaded voxel count and warm-cache count after loading settles.
- [x] 3.2 Verify nearby camera changes, including small zoom and pan adjustments, still load/refine voxel detail without holes or repeated fetch churn.
- [x] 3.3 Verify missing regions continue to report as missing and use fallback coverage when available.
- [x] 3.4 Run `npm run check`.
- [x] 3.5 Run `npm run check:knip`.
- [x] 3.6 Run `npm run typecheck`.
