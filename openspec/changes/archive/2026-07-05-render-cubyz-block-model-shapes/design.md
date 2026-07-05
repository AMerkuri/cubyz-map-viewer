## Context

Voxel mesh generation currently treats each non-air palette entry as a full cube. The server extracts visible faces by flood-filling reachable air, records cube faces keyed by integer cell coordinates, greedily merges compatible faces, and encodes integer-relative vertex positions for the client worker. The region parser already preserves the full Cubyz block value as `typ | data << 16`, but voxel generation masks it down to `typ` and ignores `data`.

Cubyz block assets already describe many non-cube shapes through layered block definitions and `assets/*/models/*.obj` files. Blocks such as torches, plants, lily pads, bars, chains, carpets, lanterns, signs, and fences use `.model`, `.rotation`, and sometimes per-block `data` to select or transform model variants. Cubyz's renderer splits model quads into internal quads and neighbor-facing quads and uses model occlusion information to decide visibility.

This change crosses server asset loading, voxel generation, worker protocol, client decoding, cache invalidation, and documentation. It should preserve the existing fast path for normal terrain cubes because full cube terrain dominates world volume.

## Goals / Non-Goals

**Goals:**

- Render supported non-cube Cubyz block models in voxel mode at LOD 1 with fractional in-block geometry.
- Keep existing greedy meshing for full cube blocks.
- Use layered Cubyz asset lookup so save assets can override core assets.
- Preserve existing `/api/voxels` compression, ETag, cache, and worker-pool behavior.
- Make unsupported model/rotation modes degrade safely to the current full-cube or air-like behavior with clear logging.
- Document the updated binary voxel payload and implementation responsibilities.

**Non-Goals:**

- Pixel-perfect parity with the entire Cubyz renderer in the first implementation.
- Full support for every Cubyz rotation mode, procedural model behavior, lighting model, transparency blend behavior, or chisel/SBB internals.
- Client-side loading of Cubyz block OBJ or texture assets for voxel geometry.
- Replacing the current color-table approach with textured block rendering.
- Changing terrain surface tile formats, region file parsing semantics, or WebSocket event names.

## Decisions

1. Use a dual mesh generation path.

   Full cube blocks continue through the existing flood-fill and greedy-merge path. Supported non-cube blocks emit explicit model quads into the same output quad stream without greedy merging. This keeps normal terrain performance and payload size close to current behavior while allowing sparse decorative blocks to use accurate geometry.

   Alternative considered: replace greedy meshing with a general model renderer for every block. This would simplify conceptual consistency but would explode quad counts for normal terrain and risk major performance regression.

2. Build a server-side block shape table at startup.

   Add a service that reads layered block definitions, applies `_defaults.zig.zon` inheritance consistently with Cubyz asset conventions, resolves `.model` references to `assets/*/models/*.obj`, parses OBJ quads, and maps save palette indices to shape metadata. `src/server/index.ts` should construct this table alongside the existing color table and pass it into `VoxelMeshService`/workers.

   Alternative considered: resolve block definitions lazily inside voxel generation. Startup construction is preferable because worker jobs need compact immutable data, startup can log unsupported assets once, and cache keys can include a single model-shape signature.

3. Encode fractional voxel vertices using fixed-point local coordinates.

   Update the voxel binary format so vertex X/Y/Z can represent fractions within a voxel cell. Use fixed-point unsigned coordinates relative to the response origin, e.g. `u16` values in units of `1/4096` cell, with world decoding equivalent to `origin + fixed * voxelSize / 4096`. This preserves deterministic compact binary payloads and avoids float rounding differences in cache comparisons.

   Alternative considered: use `float32` positions. Floats are easier to implement but increase payload size and are less explicit about coordinate bounds. A separate instanced model payload was also considered, but it would require a larger client/server protocol split and more runtime scene complexity.

4. Support a limited initial set of Cubyz model behaviors.

   The first implementation should support static string `.model` references and a small set of rotation modes needed by common non-cube blocks: `cubyz:no_rotation`, `cubyz:planar`, `cubyz:torch`, and straightforward fixed data-index variants where the logic is practical to port. Unsupported rotation modes should be logged and fall back safely.

   Alternative considered: port the whole Cubyz rotation system. That is more accurate but significantly increases scope because rotation modes can encode custom data semantics, neighbor-dependence, generated model variants, and interaction behavior.

5. Keep color rendering per block palette entry for now.

   Explicit model quads should use the same palette-index block color used for cube faces. Texture-slot-specific color sampling can be added later, but this change focuses on geometry correctness.

   Alternative considered: color each model quad from its referenced texture slot. This would improve visual fidelity for multi-texture models, but it requires extending texture candidate resolution and possibly the color table before the shape problem is solved.

6. Treat LOD behavior conservatively.

   At LOD 1, supported non-cube blocks render explicit geometry. At higher LODs, shape metadata may use `.lodReplacement` where available or fall back to existing block/color behavior. This avoids amplifying tiny decorative geometry into distant meshes.

   Alternative considered: render fractional model geometry at all LODs. This would preserve shapes everywhere but likely adds noise and payload cost in distant regions where Cubyz itself often replaces small decorative blocks with air.

## Risks / Trade-offs

- [Binary payload change breaks stale clients or cached meshes] → Bump `VOXEL_GENERATOR_CACHE_VERSION`, update client worker decoder in the same change, and update docs. Existing HTTP caching stays scoped by ETag/cache keys.
- [Explicit model quads increase payload sizes] → Keep greedy meshing for full cubes, use `.lodReplacement` for higher LODs, and monitor quad count metrics.
- [Unsupported Cubyz rotation modes render incorrectly] → Add capability-scoped fallback behavior and log unsupported modes once per block ID.
- [OBJ parsing or defaults inheritance diverges from Cubyz] → Keep parser support minimal and based on observed Cubyz conventions, then add targeted fixtures/validation around representative assets.
- [Model quads and cube faces overlap or occlude incorrectly] → Start with non-cube blocks as non-occluding unless model faces fully occupy a neighbor boundary; only suppress neighboring faces when shape metadata proves full occlusion.
- [Chisel/SBB behavior is more complex than block models] → Keep exact chisel/SBB shape support out of the first implementation and document it as future work after serialization semantics are traced.

## Migration Plan

1. Add shape metadata construction and diagnostics without changing the route contract.
2. Extend the binary encoder/decoder and bump cache version in one implementation slice.
3. Enable explicit model quads for a small representative block set and verify payloads render correctly.
4. Expand supported rotation modes and fallbacks.
5. Update architecture, server, and client docs before finishing implementation.

Rollback is straightforward: disable shape metadata usage in voxel generation or revert the change; generated voxel caches are invalidated by cache-version changes and can be rebuilt.

## Open Questions

- Which rotation modes must be included in the first implementation beyond `no_rotation`, `planar`, and `torch` to satisfy expected worlds?
- Should unsupported non-cube blocks fall back to full cube, air via `.lodReplacement`, or an explicit simplified bounding box?
- Should model quads eventually sample per-texture colors instead of using one block-average color?
- How exactly are chisel/SBB-created sub-block shapes serialized in saves, and do they require a separate capability?
