## Context

The voxel overlay is currently generated server-side as visible quads, encoded into a compact binary payload, decoded in a browser worker, and rendered by the client with a single opaque Three.js material. Block color metadata is reduced to RGB and an `airLike` flag. `ColorMapService` also treats `cubyz:glass/` IDs as air-like, which conflates two different concepts: blocks that have no renderable geometry and blocks that should be visible but view-through.

Cubyz itself treats glass as transparent renderable geometry. Glass defaults under `assets/cubyz/blocks/glass/_defaults.zig.zon` set `.transparent = true`, `.hasBackFace = true`, and `.model = "cubyz:cube"`, while individual glass color files define `.absorbedLight` and `.texture`. Cubyz chunk meshing separates opaque and transparent meshes and renders transparent chunks with a dedicated transparent shader. The map viewer does not need full shader fidelity, but it does need enough metadata and payload structure to show tinted glass while preserving visibility of opaque blocks behind multiple glass blocks.

## Goals / Non-Goals

**Goals:**

- Parse transparent block metadata from layered Cubyz block definitions, including inherited `_defaults.zig.zon` values.
- Replace the overloaded `airLike` behavior for glass with distinct air, opaque, and transparent renderable categories.
- Emit transparent voxel faces while still allowing exterior visibility traversal through transparent blocks.
- Render transparent voxel faces separately from opaque voxel faces so blocks behind one or more glass blocks remain visible.
- Preserve voxel hover block identity for transparent faces by keeping palette indices available in the decoded mesh data.
- Invalidate stale voxel mesh cache entries when the voxel payload or transparent rendering semantics change.

**Non-Goals:**

- Recreate Cubyz's full transparent shader, fog integration, reflections, texture atlas sampling, or physically correct multi-layer transmission.
- Add per-texture alpha rendering for every block texture.
- Sort every transparent triangle every frame for perfect order-dependent blending.
- Change terrain surface tile parsing or biome-colored terrain underlay behavior.

## Decisions

### Add block visual metadata instead of extending shape metadata

Transparency is a material/rendering property, not a shape property. Introduce or extend a server-side block visual table that records palette-indexed `renderKind` information such as air, opaque, and transparent, plus tint/alpha/backface fields needed by voxel meshing and encoding.

Alternative considered: store transparency on `BlockShapeTable`. That would mix material classification with geometry interpretation and force cube glass into shape-specific paths even though transparent behavior applies independently of cube/model/semantic geometry.

### Parse layered block defaults for visual metadata

Transparent metadata should come from the same Cubyz definition semantics as the game. Block visual loading should apply inherited `_defaults.zig.zon` values so `cubyz:glass/white` inherits `.transparent = true` and `.hasBackFace = true` from `glass/_defaults.zig.zon` while keeping its own `.absorbedLight` and `.texture`.

Alternative considered: continue hard-coding `cubyz:glass/` by prefix. That would cover core glass names but miss future transparent blocks, save overrides, and metadata such as backfaces or absorption.

### Treat transparent blocks as traversable but renderable

Voxel exterior traversal should pass through transparent blocks so opaque surfaces behind glass can be discovered. Unlike air, transparent blocks should also emit their own visible faces into a transparent quad stream. This creates three categories:

```text
air:          traverse, emit nothing
transparent: traverse, emit transparent faces
opaque:       stop traversal, emit opaque boundary faces
```

Adjacent transparent blocks of the same block ID/visual group should not emit internal faces, and matching exterior faces should greedily merge into larger transparent quads without per-face AO darkening. This uses visual groups rather than raw save palette indices so duplicate palette entries for the same glass type still connect. This matches Cubyz's connected-glass visual behavior better than treating `.hasBackFace` as a request to draw shared same-type boundaries or leaving per-block exterior seams. External transparent faces and boundaries between different transparent/opaque blocks should remain visible enough for glass structures to read in the map.

Cubyz glass defaults use `.model = "cubyz:cube"`; the map viewer should normalize that model reference back onto the cube/greedy path instead of treating glass as an explicit per-block model, otherwise connected-face merging cannot happen.

Alternative considered: treat transparent blocks as opaque with low alpha. That would hide blocks behind glass because traversal would stop at the first glass layer.

### Encode transparent quads separately from opaque quads

The current binary voxel format carries per-quad RGB, AO, winding, palette index, and vertex positions. Transparent rendering needs at least a way for the worker/client to separate opaque and transparent quads. The minimal contract is to add per-quad render flags or split counts so the worker can build separate opaque and transparent mesh arrays while preserving palette identity.

Alternative considered: use one geometry with vertex alpha. That still needs an alpha attribute and transparent material for all voxels, which would hurt opaque rendering and create avoidable depth/sorting issues.

### Render transparent voxels as a map-viewer approximation

The client should render opaque voxel meshes first with the existing opaque material and transparent voxel meshes afterward with `transparent: true`, `depthWrite: false`, and a fixed or metadata-derived opacity. This should allow a view like `camera -> glass -> glass -> stone` to show the stone through increasingly dense glass, with acceptable approximation artifacts.

Alternative considered: per-frame transparent triangle sorting or weighted blended order-independent transparency. Those would improve correctness but add complexity and runtime cost that is not justified for the first map-viewer implementation.

### Keep terrain-underlay visibility conservative

Transparent voxel tops should not automatically hide terrain underlay the same way opaque voxel tops do. Otherwise glass roofs can still visually behave like solid terrain occluders even when the glass material is transparent.

Alternative considered: include transparent tops in chunk top-height coverage. That is simpler but undermines the purpose of making glass view-through.

## Risks / Trade-offs

- Transparent sorting artifacts can occur inside one large transparent mesh -> Keep the first implementation scoped to approximate map-viewer rendering and avoid promising physically correct blending.
- Traversing through transparent blocks may increase visible voxel output behind glass -> Keep cache invalidation explicit and monitor payload sizes during manual verification.
- Incorrect default inheritance could misclassify glass or future transparent blocks -> Reuse one layered block-definition reader or align behavior with the shape-table loader rather than ad hoc parsing.
- Hover identity may regress if transparent quads are split into a separate mesh without palette metadata -> Preserve `trianglePaletteIndices` for both opaque and transparent submeshes.
- Cache entries generated by the old RGB-only/opaque semantics could be reused incorrectly -> Bump voxel cache/payload semantic version as part of implementation.
