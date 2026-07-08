## Context

The voxel LOD distance thresholds encode a consistent screen-space ratio: `regionWorldSize(lod) / maxDist(lod) ≈ 0.213` for every LOD level. This means "render LOD N when the tile's world size divided by its 3D distance is at least 0.213" — which is an angular size threshold.

Phase 1 (`voxel-3d-distance-lod`) makes the distance 3D, unlocking this ratio. But Phase 1 still uses a single `referenceSurfaceZ` fallback for candidate selection. That works for unloaded terrain below a high-altitude camera, but it fails for foreground geometry that is actually close to the camera: a loaded chunk in front of the user at `z≈3500` can occupy significant screen space while the global reference surface remains near spawn/terrain height, causing the visible chunk to stay at LOD8. The ratio also assumes a specific FOV and viewport size. The camera FOV is hardcoded at 60° (`scene-runtime.ts:153`). The viewport varies with the browser window.

The angular size of a tile is: `(tileWorldSize / dist3D) * (1 / (2 * tan(fov/2)))`. The thresholds were tuned for FOV=60°. If FOV changes (e.g., future zoom feature) or viewport size differs significantly, the same angular size produces different pixel coverage:

```
apparentPixels = angularSize * viewportHeight / 2
```

A tile at the same 3D distance appears:
- **Larger** on a 4K viewport → could afford finer LOD
- **Smaller** on a 720p viewport → could use coarser LOD
- **Larger** with narrower FOV (zoom) → could afford finer LOD
- **Smaller** with wider FOV (wide lens) → could use coarser LOD

## Goals / Non-Goals

**Goals:**
- Make LOD selection responsive to camera FOV by scaling the effective distance.
- Make LOD selection responsive to viewport height by scaling the effective distance.
- Use actual loaded voxel tile bounds/local top-height data for loaded tiles so visible foreground geometry is not forced through the global reference-surface fallback.
- Bias LOD selection finer around the resolved focus point/raycast hit.
- Expose reference FOV and viewport height as debug settings for tuning.
- Preserve bounded balanced-preset memory for close ground-level views while allowing presets/users to tune the viewport baseline.

**Non-Goals:**
- Implementing FOV zoom as a user feature (this change just makes the LOD system ready for it).
- Full exact projected polygon coverage for every candidate tile. This change may use approximate projected diameter/height from bounds and distance, but does not require clipping tile geometry to the viewport.
- Changing the threshold values themselves (they remain the source of truth for LOD boundaries; the modifiers adjust the input distance, not the thresholds).

## Decisions

### Decision 1: Use loaded tile bounds before reference-surface fallback

**Choice**: For loaded voxel tiles, compute distance to the tile's actual 3D bounds using `minZ/maxZ` and, where available, the local `chunkTopHeights` sample near the camera/focus point. Use this loaded-bounds distance for projected-size/focus refinement and unload decisions. Continue using `referenceSurfaceZ` for unloaded candidates and root traversal where no vertical bounds exist yet.

**Alternatives considered**:
- **Only use `referenceSurfaceZ`**: Simple, but misses high-altitude foreground geometry and is the bug this follow-up must address.
- **Require vertical bounds for all chunk-index entries**: More accurate but requires index/server contract changes, which are out of scope.

**Rationale**: Loaded tiles already carry enough bounds/top-height information to make better decisions for visible geometry without changing server contracts. Unloaded entries can still use the cheap Phase 1 fallback until they load.

### Decision 2: Approximate projected size for loaded tiles

**Choice**: Estimate loaded tile apparent size from `regionWorldSize(lod)`, distance to loaded tile bounds, camera FOV, and viewport height. If the projected size exceeds the threshold implied by a finer LOD, allow/request refinement even if reference-surface distance alone would choose a coarser LOD.

**Rationale**: The user-visible problem is screen occupancy. Approximate projected diameter is much cheaper than exact projected polygon area and sufficient for LOD selection with existing hysteresis.

### Decision 3: Bias focus-adjacent tiles finer

**Choice**: Pass the resolved voxel focus point into voxel LOD selection. Tiles whose horizontal/3D bounds contain or are near that point get a configurable distance reduction or desired-LOD clamp toward finer levels.

**Rationale**: The focus point is where the user is looking/clicking/raycasting. It should be allowed to refine before surrounding terrain, especially in high-altitude views where only a small foreground area needs fine detail.

### Decision 4: Apply FOV/viewport modifiers to distance fallback, not thresholds

**Choice**: Compute a `screenSpaceDistanceScale` multiplier and apply it to the 3D effective distance before threshold comparison, rather than scaling the thresholds.

**Alternatives considered**:
- **Scale thresholds**: Multiply `maxDist` by a factor. Equivalent mathematically, but requires modifying every threshold entry and is more invasive to the threshold comparison code.
- **Replace thresholds with pixel-based system**: Compute actual projected pixel size for each tile and compare against pixel thresholds. More accurate but requires a completely new threshold system, FOV/viewport plumbing everywhere, and re-tuning all presets.

**Rationale**: A single multiplier on distance is minimal, composable with Phase 1's 3D distance, and keeps the threshold structure intact. The math is equivalent: `dist * scale vs threshold` ⟺ `dist vs threshold / scale`.

### Decision 5: Compute scale as `currentFov / referenceFov * referenceViewportHeight / currentViewportHeight`

**Choice**: The FOV factor is `tan(curFov/2) / tan(refFov/2)` and the viewport factor is `refHeight / curHeight`. The combined scale is their product.

**Rationale**: 
- FOV: `tan(60°/2) / tan(60°/2) = 1.0` at default (no change). Narrower FOV (e.g., 40°) → `tan(20°)/tan(30°) ≈ 0.63` → perceived distance shrinks → finer LOD. This is correct: zooming in makes tiles appear larger, so they deserve more detail.
- Viewport: `refHeight / curHeight`. When current height matches the configured reference height → 1.0 (no change). Larger viewports shrink perceived distance → finer LOD. Smaller viewports grow perceived distance → coarser LOD.

### Decision 6: Compute once per LOD update cycle

**Choice**: Compute `screenSpaceDistanceScale` once at the top of the LOD update (in `checkAndUpdateLod` or `World3DView.tsx`), pass it as a number through the call chain.

**Rationale**: FOV and viewport size don't change per-tile. Computing once avoids redundant `Math.tan` calls across hundreds of tiles. Matches the pattern from Phase 1 where `referenceSurfaceZ` is computed once.

### Decision 7: Balanced defaults prefer bounded memory over 1080p neutrality

**Choice**: `lodReferenceFov = 60` and `lodReferenceViewportHeight = 2880` for default/balanced settings.

**Rationale**: The camera FOV is hardcoded at 60° (`scene-runtime.ts:153`). A 1080px baseline proved too demanding after loaded-bounds/focus refinement, reaching multi-GB LOD1 memory in close ground-level views. A 2880px balanced baseline keeps the reproduced close focus case below 1 GB of LOD1 memory while higher-quality presets can still opt into a finer baseline.

### Decision 8: Preset baseline values are monotonic around Balanced

**Choice**: Use progressively finer baseline values for higher-quality presets and progressively coarser baseline values for performance presets: Extreme `75/720`, Quality `62/2400`, Balanced `60/2880`, Performance `50/3600`, Ultra Performance `40/4320` for baseline FOV / baseline viewport height.

**Rationale**: Higher baseline FOV and lower baseline viewport height both reduce the effective distance scale and select finer LOD. Lower baseline FOV and higher baseline viewport height increase the scale and select coarser LOD. Keeping presets monotonic makes the controls easier to reason about and prevents performance presets from accidentally being finer than Balanced.

## Risks / Trade-offs

- **[Trade-off] Approximation vs true projected area** → The distance-based approach doesn't account for oblique viewing angles where tiles at the edge of the viewport appear smaller than tiles at the center. True projected area would handle this, but it's expensive (requires per-tile projection) and the benefit is marginal — the hysteresis already smooths boundary transitions.

- **[Risk] Focus bias over-refines small areas** → A focus-adjacent refinement can increase LOD1 residency. Keep the bias local to tiles containing/near the focus point and preserve existing render-distance, debounce, and unload hysteresis constraints.

- **[Risk] Loaded-bounds refinement cannot help completely unloaded foreground geometry immediately** → Initial root selection still needs fallback distance until coarser tiles load and provide bounds. This is acceptable because the refinement should converge once loaded bounds exist.

- **[Risk] Viewport resize churn** → When the user resizes the browser window, the viewport factor changes, which could trigger LOD transitions. The existing hysteresis (`voxelLodHysteresisRatio`) should absorb small resizes. Continuous drag-resizing could cause some LOD flipping, but this is already the case with camera movement.

- **[Risk] Future FOV zoom could cause rapid LOD changes** → If FOV zoom is implemented as a smooth animation, the LOD system would continuously re-select as FOV changes. The existing `voxelDetailRequestDebounceMs` and motion detection should mitigate this, but it's an interaction to watch.

- **[Trade-off] Two new debug settings increase tuning surface** → Users now have two more knobs. The defaults are set to preserve existing behavior, so most users won't touch them. But presets need updating to include them.

- **[Risk] Performance of `Math.tan` per frame** → Computed once per LOD update (not per tile), so the cost is negligible — one `Math.tan` call per frame.
