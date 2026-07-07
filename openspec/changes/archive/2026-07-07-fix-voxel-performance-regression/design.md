## Context

Voxel mode currently routes region requests through `VoxelMeshService`, generates binary mesh payloads on the server, decodes them in the browser voxel worker, then builds Three.js geometries in `World3DView`'s imperative runtime path. Recent changes improved visual correctness by adding Cubyz model/semantic block geometry, transparent voxel separation, fixed-point fractional vertex positions, and palette identity for hover. At the reported regression location, master loads a similar number of voxel regions as `v1.1.0` but carries much larger LOD1 payloads and retained geometry.

The likely cost centers are:

- Server payload size: common cube faces now use the same fixed-point vertex encoding required by fractional model vertices.
- Server quad count: LOD1 model/semantic blocks emit explicit quads that are not greedily merged.
- Client decode and retention: the worker builds extra arrays for transparent separation and palette identity, and the mesh builder retains CPU-side color/AO arrays in addition to geometry attributes.
- LOD selection: stabilized horizontal distance behavior may keep more LOD1 detail resident in vertical terrain.

## Goals / Non-Goals

**Goals:**

- Bring voxel FPS, stutter, worker input size, and retained memory closer to `v1.1.0` for comparable stable camera positions without removing recent visual features.
- Make the regression measurable by exposing enough debug metrics to distinguish payload size, cube quads, model quads, transparent quads, queued geometry, loaded geometry, and warm-cache memory.
- Optimize the hot path for common cube/greedy geometry while preserving fractional coordinates for block model geometry.
- Keep hover block identity and transparent rendering functional after payload or retention optimizations.
- Keep voxel LOD stabilization stable while preventing unnecessary LOD1 detail retention.

**Non-Goals:**

- Removing Cubyz block model rendering, transparent voxel rendering, or hover block identity.
- Replacing the voxel service, worker pool, React/Three runtime architecture, or cache model wholesale.
- Adding a new test runner.
- Changing save-file parsing semantics except where required for cache signatures or diagnostics.

## Decisions

1. Split measurement from optimization.

   Add or refine diagnostics first so implementation can compare before/after behavior at the reported URL. The key counters should include raw payload bytes, decoded payload bytes, total quads, model/semantic quads, transparent quads, worker output array bytes, loaded geometry bytes, retained CPU-side metadata bytes, warm-cache bytes, and loaded counts by LOD.

   Alternative considered: immediately tune cache sizes or LOD thresholds. That risks hiding the regression rather than identifying whether payload, quad count, retention, or selection is dominant.

2. Prefer compact mixed encoding over globally expensive fixed-point positions.

   Common full-cube greedy faces do not need fractional `u32` fixed-point coordinates. The voxel wire format should support a compact integer path for ordinary cube quads and a fractional path only for model/semantic quads or any future geometry that requires sub-cell precision.

   Alternative considered: keep the current single fixed-point format and rely on Brotli. This keeps code simpler but leaves decoded bytes, worker input, and typed-array decode work high even when compression hides transfer size.

3. Bound detailed model geometry at LOD1.

   Model/semantic shape emission should remain correct but must have a budget. The server can track model quad counts per region and apply targeted fallback behavior for excessive decorative geometry, or the client can expose settings that lower model detail when memory pressure is high. Any fallback must be documented and cache-versioned.

   Alternative considered: disable model rendering globally. That would improve performance but regress the visual correctness features this project recently added.

4. Preserve hover identity with lighter retention.

   Palette identity is needed per intersected face, but it does not necessarily require duplicating large per-vertex color/AO arrays or storing one `Uint32` per triangle in the most expensive form. Keep enough face-to-palette information for cursor lookup while reducing duplicate CPU-side arrays where possible.

   Alternative considered: remove hover identity for model or transparent faces. That violates existing behavior and should only be a fallback under an explicit debug/performance mode, not the default.

5. Correct memory accounting separately from memory reduction.

   The debug HUD should distinguish estimated GPU/geometry attribute bytes from retained CPU metadata bytes and avoid double-counting attributes already installed on geometry. This makes future regressions easier to interpret even if actual runtime memory remains browser-dependent.

   Alternative considered: leave current estimates and rely on browser heap tools. Browser heap is not always available in the HUD and does not explain geometry/warm-cache distribution by LOD.

6. Validate LOD stabilization at stable camera samples.

   Reintroducing Z distance wholesale may restore old oscillation behavior. Instead, evaluate the current horizontal-only distance at the regression URL and only adjust selection if it is proven to retain/select excess LOD1 detail. Any change must preserve stationary convergence.

   Alternative considered: revert the LOD stabilization commit. That risks reintroducing the loaded tile count oscillation the current spec protects against.

## Risks / Trade-offs

- Wire-format changes can break stale persisted voxel mesh caches -> bump the voxel generator cache version and update client/server docs when the binary payload changes.
- Mixed compact/fractional encoding increases decoder complexity -> isolate format parsing in the server encoder and client worker, and keep validation strict with explicit truncation errors.
- Model fallback can reduce visual fidelity in dense decorative regions -> prefer targeted budget behavior and expose diagnostics so the trade-off is visible.
- Reducing retained CPU arrays can break AO updates or hover identity -> verify cursor hover, AO boundary refresh, transparent faces, and stale tile replacement after changes.
- Memory estimates may still differ from actual browser/GPU memory -> label estimates by category and keep them internally consistent rather than claiming exact process memory.
- Performance improvements can be data-location dependent -> use the supplied URL as the baseline scenario and also inspect a low-detail region to avoid overfitting.
