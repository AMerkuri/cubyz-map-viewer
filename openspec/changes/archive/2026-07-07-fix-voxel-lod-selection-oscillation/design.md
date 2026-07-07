## Context

The voxel viewer currently computes the requested voxel tile set from the camera, loaded voxel tiles, available voxel index entries, LOD thresholds, and parent/child fallback coverage. Loaded tiles that are no longer selected are moved to the warm cache, and requested tiles may be restored from that cache without network or worker work.

At the reproduced stationary view `?x=565&y=5547&z=35&zoom=90&theta=-91&phi=27&focus=exact`, the debug panel alternates between 183 and 197 loaded chunks while the voxel warm cache alternates between 14 and 0 entries. Loading, fetch queue, and mesh queue remain at 0, proving the churn is local residency selection rather than server or worker throughput.

The likely failure mode is that a stable camera produces two alternating voxel selection states: one state restores a set of warm cached tiles, and the next state decides those same tiles are no longer requested or visible and unloads them again.

## Goals / Non-Goals

**Goals:**

- Make voxel LOD selection converge to a stable loaded/warm-cache state when the camera and world data are unchanged.
- Preserve parent/child fallback behavior so visible coverage remains continuous during detail refinement and missing-region handling.
- Keep warm-cache restore fast and local without introducing new network requests for already cached tiles.
- Keep per-frame scene/runtime state in refs and world-view runtime modules, not React state.
- Add targeted instrumentation or tests that can demonstrate the reproduced 183/197 oscillation is fixed.

**Non-Goals:**

- Changing server voxel APIs, compression, region file parsing, or WebSocket contracts.
- Reworking terrain LOD selection or terrain warm caching.
- Changing the visual LOD thresholds, render distance presets, or debug slider semantics unless required by the fix.
- Replacing the existing warm-cache mechanism.

## Decisions

1. Treat stable voxel residency as a selection invariant, not a longer cache grace period.

   The browser probe showed that increasing `voxelUnloadGraceMs` only delays the drop: at 1500ms the low state appears every third sample, and at 5000ms it appears roughly every sixth sample. The implementation should therefore address why the request/visibility set alternates, not simply raise default grace values.

   Alternative considered: increase the default unload grace above the idle LOD poll interval. This masks the symptom but still permits periodic drops and retains memory longer without fixing selection.

2. Debug the transition by comparing selected/requested/restored/unloaded keys across consecutive LOD passes.

   The implementation should identify the exact 14 keys that move between `loadedVoxels` and `warmCachedVoxels` and determine whether they are falling out through parent/child fallback, detail request debounce, quadrant visibility, or stale/missing state. Temporary diagnostics should remain local to the implementation effort unless a concise reusable helper or test fixture is useful.

   Alternative considered: infer the root cause only from aggregate counts. Counts confirmed the class of bug but are insufficient to choose the minimal safe fix.

3. Prefer a minimal stabilization point inside voxel selection/runtime boundaries.

   The fix should live around `runVoxelLodSelection`, `syncVoxelRequests`, or warm-cache restore/unload decisions. It should avoid moving the problem into React state or changing server routes. Candidate approaches include making restored cached tiles eligible for retention during the same stable selection window, separating coverage retention from detail request commitment, or preventing a tile restored for a stable camera from being unloaded until selection has consistently excluded it across consecutive LOD passes.

   Alternative considered: globally keeping all warm-restored tiles loaded until camera movement. That would be simple but could over-retain stale detail in large views and weaken memory controls.

4. Keep runtime behavior unchanged for real invalidations.

   World updates, stale voxel refreshes, missing region handling, and explicit cache eviction must continue to override retention. Stability should apply to unchanged camera/world state, not to data that the server or WebSocket layer marks stale.

## Risks / Trade-offs

- [Risk] Stabilizing retention too broadly increases voxel memory usage. -> Mitigation: scope retention to tiles involved in stable-camera selection churn and keep warm-cache limits effective.
- [Risk] Parent/child fallback changes could reveal holes or duplicate overlapping LOD geometry. -> Mitigation: verify visible coverage and LOD counts at the reproduced URL and at nearby zoom/pan positions.
- [Risk] A fix based only on the reproduced URL may miss other LOD boundary cases. -> Mitigation: include checks for stationary convergence at multiple zooms or use a deterministic unit-level selection fixture if practical.
- [Risk] Instrumentation can become noisy or expensive. -> Mitigation: keep diagnostics temporary or gated, and remove ad hoc logging before completion.

## Migration Plan

No data migration is required. The change is client runtime behavior only. Rollback is reverting the voxel selection/runtime changes.

## Open Questions

- Which exact selection path excludes the 14 oscillating tiles on the low-state pass?
- Is a unit-level test feasible for `runVoxelLodSelection` with a compact synthetic voxel tree, or is browser-level/manual verification more practical for this behavior?
- Should any final diagnostic counters be exposed in the debug panel, or should the fix remain internal only?
