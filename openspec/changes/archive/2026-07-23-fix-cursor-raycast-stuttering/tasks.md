## 1. Cursor Picking Mechanics

- [x] 1.1 Add hermetic client tests proving hover candidate collection prunes locally hidden objects and complete invisible ancestor branches while retaining visible voxel and terrain meshes.
- [x] 1.2 Add hermetic client tests proving repeated refresh requests coalesce into one scheduled query, use the latest pointer coordinates, and can be cancelled before execution.
- [x] 1.3 Implement visible candidate collection for voxel and terrain hover raycasts and pass candidates non-recursively to Three.js without changing visible voxel tie-breaking, block identity, or terrain fallback.

## 2. Hover Refresh Scheduling

- [x] 2.1 Route eligible mouse movement and delayed control refreshes through a single animation-frame coalescer that evaluates the latest pointer and interaction state at execution time.
- [x] 2.2 Preserve touch-hold inspection and suppression during drag, keyboard movement, cancellation, and pointer leave while cancelling pending timers and animation-frame work during reset and teardown.
- [x] 2.3 Extend client tests for voxel precedence, visible fine-LOD overlap, terrain fallback, interaction suppression, and cleanup behavior.

## 3. Documentation And Verification

- [x] 3.1 Update `docs/client-specification.md` to describe visible-only cursor picking, coalesced hover refreshes, and preserved input/selection behavior.
- [x] 3.2 Run `npm test && npm run check && npm run check:knip && npm run typecheck` and resolve any regressions.
- [x] 3.3 Validate in the browser at minimum voxel LOD 1 with terrain both enabled and disabled, confirming continuous pointer movement after orbit release no longer causes heavy stuttering and hover identity remains correct.
