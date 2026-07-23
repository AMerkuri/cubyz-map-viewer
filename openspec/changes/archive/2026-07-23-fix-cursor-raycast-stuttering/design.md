## Context

Cursor hover is owned by the imperative world-view runtime. Mouse movement outside an active drag currently performs a synchronous recursive Three.js raycast against the voxel group and, when no voxel is selected, the terrain group. Three.js raycasting does not skip objects whose `visible` flag is false, so retained coarse meshes, hidden replacement meshes, and other overlapping LOD geometry still incur bounding-volume and triangle intersection work before voxel hits are filtered. Pointer events can also arrive faster than rendered frames, causing the same scene to be queried repeatedly with no visible benefit.

The observed cost scales with voxel detail: LOD 32 without terrain does not stutter, terrain adds a smaller cost, and LOD 1 causes heavy stuttering while the pointer moves over the canvas. Leaving the canvas disables hover inspection and removes the stutter. The fix must remain inside the existing imperative cursor/runtime boundary and preserve block identity from the selected face.

## Goals / Non-Goals

**Goals:**

- Exclude effectively hidden voxel and terrain objects before invoking Three.js mesh raycasts.
- Bound hover intersection work to one query per browser animation frame while using the latest pointer position.
- Preserve visible voxel precedence, fine-LOD tie-breaking, transparent/model-backed block identity, terrain fallback, and input suppression behavior.
- Make candidate selection and refresh coalescing independently testable without a browser, WebGL context, or real save.

**Non-Goals:**

- Add a mesh BVH, spatial index, new runtime dependency, or worker-based picking.
- Change voxel LOD selection, retention, rendering visibility, OrbitControls damping, or idle frame-rate behavior.
- Change tap selection, camera focus raycasts, HTTP/WebSocket contracts, or server behavior.
- Guarantee a fixed millisecond budget for an individual raycast on arbitrary hardware.

## Decisions

### Collect effectively visible leaf candidates before raycasting

Cursor picking will derive candidate objects from the current voxel and terrain groups at inspection time, pruning any branch whose own or ancestor visibility excludes it from rendering. The resulting candidates will be passed non-recursively to the raycaster so hidden descendants cannot re-enter the query. Candidate derivation will remain local to cursor inspection rather than adding a second visibility registry that could become stale during LOD replacement and cache transitions.

This keeps selection aligned with the rendered scene and removes work that currently produces no valid result. Voxel intersections will retain the existing best-hit selection and fine-LOD tie-break behavior for visible overlap. Terrain picking will likewise exclude hidden tiles before choosing its nearest hit.

Alternatives considered:

- Filtering intersections after a recursive raycast is the current behavior and does not avoid expensive mesh tests.
- Assigning raycaster layers whenever visibility changes would couple cursor concerns to terrain, voxel LOD, cache, and disposal paths.
- Maintaining cached candidate arrays would reduce a small traversal cost but introduce invalidation complexity; scene candidate traversal is expected to be much cheaper than triangle intersection.

### Coalesce hover refreshes at the cursor boundary

Hover-producing pointer events will update the stored pointer coordinates and request inspection through a single animation-frame gate. If inspection is already pending, later events will only replace the stored coordinates. The callback will evaluate the latest interaction state immediately before querying, so pointer down, pointer leave, keyboard movement, cancellation, or teardown can suppress stale work.

Existing delayed refreshes caused by camera/control changes will converge on the same gate before executing a query. Touch-hold inspection will preserve its explicit permission to inspect while that hold is active. Cleanup will cancel both delayed timers and any pending animation-frame callback.

Animation-frame coalescing is preferred over a trailing debounce because it preserves responsive cursor coordinates during continuous movement. It is preferred over a fixed interval because it naturally follows the active display cadence and avoids duplicate queries between rendered frames.

### Keep scheduling and candidate policy testable as pure mechanics

Small module-local or reusable helpers will express visible candidate collection and single-pending-refresh behavior. Core client tests will use Three.js groups/meshes and a fake scheduler to verify hidden-branch pruning, visible overlap behavior, event coalescing, latest-coordinate use, and cancellation. Integration remains in `cursor.ts`; per-frame state will not move into React.

## Risks / Trade-offs

- [Visible LOD 1 geometry may still make one raycast expensive] -> First remove hidden geometry and duplicate per-frame queries, then profile the remaining single-query cost before considering BVH or spatial indexing.
- [Scene visibility can change between scheduling and execution] -> Derive candidates and check interaction state when the scheduled callback runs, not when it is requested.
- [Animation-frame coalescing can add up to one frame of tooltip latency] -> Accept the bounded latency in exchange for eliminating redundant work; always use the newest pointer coordinates.
- [A nested visible mesh under an invisible ancestor could be selected accidentally] -> Candidate traversal must prune invisible branches rather than filtering only each leaf's local `visible` flag.
- [Changing terrain candidate filtering can alter incorrect hits from hidden tiles] -> Treat this as a correctness fix: only rendered terrain is eligible, while visible terrain remains the fallback when no visible voxel is hit.

## Migration Plan

This is a client-internal behavior change with no stored-data or protocol migration. Deploy it with the normal client build. Rollback consists of reverting the cursor candidate and scheduling changes; no server rollback is required.

## Open Questions

- Whether visible-only, once-per-frame queries are sufficient at the densest supported LOD should be resolved by browser profiling after implementation. A spatial acceleration structure is intentionally deferred unless measured evidence still shows unacceptable single-query cost.
