## Context

`runVoxelLodSelection` currently computes both the desired LOD frontier and the immediately visible quadrant masks in one traversal. Refinement is coverage-safe because a loaded parent remains visible quadrant by quadrant while finer children load. Coarsening is asymmetric: traversal stops at a desired ancestor, requests it when absent, and omits loaded descendants from the new masks. Visibility reconciliation hides those descendants before unload grace is evaluated, so resident resources cannot prevent the resulting hole.

The supported voxel hierarchy has six bounded LOD levels (`1, 2, 4, 8, 16, 32`), and loaded tiles are keyed by aligned LOD and horizontal region coordinates. A tile becomes scene-ready when it has been inserted into `loadedVoxels`; worker output or warm-cache state alone is not renderable coverage. The change should remain inside the imperative client runtime and should not alter request, worker, or server contracts.

## Goals / Non-Goals

**Goals:**

- Preserve already-loaded voxel coverage while zoom-out or view classification selects an unloaded coarse ancestor.
- Replace fine fallback coverage as soon as the desired coarse tile is present in `loadedVoxels`.
- Support fallback descendants at mixed loaded depths without overlapping parent and child geometry.
- Keep fallback discovery independent from fine-detail demand so coarsening does not launch or retain obsolete fine work.
- Preserve existing unload grace, warm-cache, request-priority, invalidation, and AO reconciliation behavior.

**Non-Goals:**

- Changing LOD distance thresholds, camera hysteresis, request priority, concurrency, or warm-cache limits.
- Guaranteeing coverage where no suitable voxel tile was already loaded.
- Prefetching coarse ancestors before they become desired.
- Changing terrain-underlay fallback behavior or server-side voxel warmup.
- Introducing a general two-frontier state model outside the selector.

## Decisions

### Discover a loaded descendant frontier when a desired tile is absent

When traversal reaches a tile at the desired LOD and that tile is not loaded, the selector will still request it through the existing coverage path. Before visibility masks are committed, it will recursively inspect that tile's immediate finer subregions for loaded fallback coverage.

For each subregion, the search will select the first loaded tile encountered, mark all of that tile's quadrants visible, and stop descending that branch. If the immediate child is not loaded, the search continues toward finer supported LODs. This produces the coarsest currently loaded, non-overlapping descendant frontier and supports mixed depths across the ancestor footprint.

The hierarchy is bounded to the supported LOD levels, so a direct recursive search is small and deterministic. Using aligned child identities from the existing voxel-index helpers avoids introducing a spatial index.

Alternatives considered:

- Keeping the previous pass's masks would preserve the exact last frame but would require persistent selector output and careful invalidation when camera eligibility or world data changes.
- Retaining all loaded descendants would be simpler but could render overlapping LODs and cause z-fighting.
- A separate target and visible frontier would be architecturally cleaner but is a larger refactor than this directional gap requires.

### Fallback discovery does not create fine demand

The descendant search will only inspect `loadedVoxels` and update visibility/retention state. It will not call the normal selection recursion and will not add detail or coverage requests for missing descendants. Existing obsolete fine fetches and worker jobs may therefore be cancelled while their already-loaded scene resources remain visible.

This separates work demand from visible fallback retention without adding persistent state. Because fallback tiles receive nonzero visibility masks, existing visibility reconciliation also refreshes unload grace and prevents them from moving to the warm cache prematurely.

### Loaded scene membership is the swap readiness boundary

An ancestor in fetch, compact input, worker execution, expanded output, or warm cache is not ready to replace visible descendants. The selector will continue to retain descendants until the ancestor appears in `loadedVoxels`. On the next selection pass, the existing loaded-self branch marks the ancestor visible and no longer marks its descendants; the swap therefore occurs in one visibility reconciliation pass.

This uses the same readiness boundary as current rendering and requires no cross-key transaction. Scene insertion already requests an immediate LOD update, while a synchronous warm-cache restore becomes eligible on the following update.

### Verify the lifecycle across multiple selector passes

The regression test will model a desired coarse parent with loaded fine descendants, assert that the descendants remain visible while the parent request is outstanding, then add a scene-ready parent and rerun selection. It will assert that the parent becomes visible and descendants are hidden, demonstrating that normal retirement can proceed only after replacement coverage exists.

The test will exercise real submesh visibility masks rather than only request LODs, because the defect occurs between residency and visibility. Existing coarse-to-fine coverage tests remain unchanged.

## Risks / Trade-offs

- [Fine fallback remains resident indefinitely if coarse loading repeatedly fails] → This intentionally prefers existing visible coverage over a hole; normal distance eligibility and world/index changes still bound retention.
- [Recursive discovery could select loaded tiles that were not visible in the previous pass] → Select the first loaded tile per branch to produce a non-overlapping, coarsest-ready fallback; add mixed-depth coverage assertions if implementation exposes ambiguity.
- [Fallback masks can affect AO seam relationships] → Reuse the existing visibility-mask map and AO application path, and run the client/core voxel correctness suites.
- [Valid empty loaded tiles have no visible submeshes] → Treat loaded membership as resolved coverage, consistent with the selector's existing empty-column semantics.
- [Warm-cache restoration may still require a follow-up selection pass] → Keep this out of scope because scene insertion already schedules updates and loaded descendants prevent a visible gap during the interval.

## Migration Plan

No data or protocol migration is required. Deploy as a client runtime change with its regression test and updated client specification. Rollback consists of reverting the selector fallback logic; no persisted state is introduced.

## Open Questions

None. The implementation can remain local to voxel LOD selection unless testing reveals a need to expose visibility masks for assertions.
