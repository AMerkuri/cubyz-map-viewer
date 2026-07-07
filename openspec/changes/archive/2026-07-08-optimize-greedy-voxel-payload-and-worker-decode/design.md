## Context

The viewer currently serves voxel regions as compressed binary payloads from `VoxelMeshService`, decodes them in the browser voxel worker, and then builds Three.js geometries on the main thread. The previous performance change introduced metrics and a mixed integer/fixed coordinate payload, but the regression URL still shows voxel loading as the main bottleneck: current idle samples average about `1.3 MB` worker input and `57.4 ms` decode time compared with `585.8 KB` and `38.2 ms` on `1.1.0`.

Sampling nearby regions shows two dominant cost centers:

- LOD1 model/semantic geometry can still hit the current `20,000` model-quad cap per region, with tens of thousands of additional model quads dropped.
- Ordinary greedy cube geometry still stores four explicit vertices per quad, even though a greedy cube quad is fully described by face direction, plane, row/column origin, and extents.

The payload is compressed over HTTP, so transfer size is not the primary remaining issue. The browser receives decompressed bytes through `Response.arrayBuffer()`, and the worker then pays decode and allocation costs for that raw payload. Optimizing raw decoded bytes and worker output construction should directly improve the voxel loading section.

## Goals / Non-Goals

**Goals:**

- Reduce raw decoded voxel payload bytes for common greedy cube geometry.
- Reduce browser worker decode time and transient worker allocations.
- Preserve fractional model/semantic geometry, transparent voxel separation, AO behavior, and hover block identity.
- Improve diagnostics so greedy/model/transparent quad mix, model-budget pressure, raw payload bytes, and worker-output bytes are visible during regression comparisons.
- Keep voxel service routing, cache invalidation, and worker build boundaries explicit and documented.

**Non-Goals:**

- Removing model/semantic block geometry, transparent rendering, AO, or cursor hover identity.
- Using idle FPS as a primary success metric; idle frame-rate caps intentionally affect it.
- Rewriting voxel LOD selection wholesale.
- Adding a new test runner or replacing the current server/client worker architecture.

## Decisions

1. Encode greedy cube quads parametrically.

   Greedy cube quads are axis-aligned rectangles. Instead of storing four XYZ vertices, encode each greedy quad as `face`, `plane`, `u`, `v`, `du`, and `dv` in cell coordinates plus existing per-quad metadata. The worker reconstructs the same four world-space vertices from those fields. Model/semantic quads keep the fractional vertex path because they can have authored non-axis-aligned or out-of-block coordinates.

   Alternative considered: keep explicit integer vertices and rely on Brotli. This helps transfer size but still leaves large decompressed worker input and decode work.

2. Use a cache-versioned mixed payload section layout.

   The payload should clearly separate greedy records from model/fractional records or otherwise encode a compact per-record kind with no avoidable per-quad overhead. Persisted voxel mesh caches must be invalidated when this layout changes.

   Alternative considered: extend the current position-kind array further. That is simpler, but the current per-quad source/position-kind side arrays add overhead and require extra worker scans.

3. Decode into final quadrant output after a counting pass.

   The worker should avoid building one full-region set of positions, normals, colors, AO, palette indices, and indices only to split it into quadrant arrays. A first pass can count output vertices/indices per quadrant and opaque/transparent stream, and a second pass can write directly into the arrays transferred to the main thread.

   Alternative considered: keep full-region intermediates and only reduce payload size. That is lower risk but leaves decode-time memory pressure and transient allocation spikes.

4. Preserve identity and render separation as record metadata.

   Every decoded triangle still needs a palette index for hover identity, and each record still needs render kind so transparent triangles go to the transparent output stream. The optimized greedy path must not rely on inferred block identity after decode.

   Alternative considered: omit hover metadata for compact greedy records. That violates existing behavior and would make optimized geometry less debuggable.

5. Treat model budget tuning as a measured follow-up inside this change.

   Parametric greedy encoding changes the raw-byte balance. After implementing it, re-sample dense LOD1 regions and decide whether the model-quad budget should remain `20,000`, be lowered, or become byte-budget based. Any fallback must remain visible in metrics.

   Alternative considered: immediately lower the model cap first. That may help, but it does not address the large greedy geometry cost across all LODs.

## Risks / Trade-offs

- Payload format complexity increases -> isolate encoding/decoding helpers and keep strict truncation validation.
- Direct quadrant decoding can duplicate shared vertices across triangles more than the current index-map path -> measure worker output bytes and retained geometry bytes, and prefer decode-time stability only if retained memory does not regress materially.
- Parametric greedy records may mishandle winding, AO corner order, or face normals -> define a single face descriptor table shared conceptually by encoder and decoder and verify all six faces.
- Cache-version mistakes can reuse stale persisted meshes -> bump `VOXEL_GENERATOR_CACHE_VERSION` for any binary layout change.
- Model budget tuning can reduce visual detail in dense decorative regions -> expose `modelQuads`, `droppedModelQuads`, and budget pressure in metrics/HUD before changing defaults.
