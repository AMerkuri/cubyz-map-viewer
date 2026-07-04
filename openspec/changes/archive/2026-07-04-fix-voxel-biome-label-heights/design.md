## Context

Biome labels are rendered by `refreshBiomeLabels` in the world-view feature. The `/api/biomes` route returns biome names, XY centroids, and cell counts, but it does not return height data. Terrain mode currently assigns one label height per visible terrain tile from that tile mesh bounding box. Voxel mode assigns one label height per indexed surface tile from either the camera target height or the maximum Z of a containing loaded voxel region.

This creates a visible mismatch: terrain labels appear staggered across the landscape, while voxel labels can collapse onto a shared horizontal plane. The change is limited to label placement behavior in the client unless a later implementation spike proves existing local height data is insufficient.

## Goals / Non-Goals

**Goals:**

- Make voxel-mode biome labels use a local height estimate near each biome centroid.
- Avoid flat label shelves caused by camera-target fallback or whole-region maximum height.
- Preserve existing label selection, text formatting, and terrain-mode behavior unless small refactoring is needed.
- Keep the implementation inside the world-view feature and out of React state/per-frame rendering paths.

**Non-Goals:**

- Redesign biome region extraction or label density/overlap behavior.
- Change the `/api/biomes` response contract by default.
- Add new visual styling or label occlusion behavior.
- Rework voxel mesh generation beyond exposing/using existing local top-height information.

## Decisions

### Use Client-Side Local Height Resolution First

Voxel-mode labels should resolve Z from data already available in the loaded scene where possible. The current voxel worker produces `chunkTopHeights` per loaded voxel region, and voxel submeshes contain geometry that can be queried if a more exact local height is needed.

Alternatives considered:

- Extend `/api/biomes` to include surface heights. This would create a shared route contract change and documentation burden for a client rendering issue.
- Use terrain tile bounding boxes in voxel mode. This would improve variation but still gives one Z per tile and may not follow visible voxel geometry.
- Use voxel region `maxZ`. This is the current behavior and is too coarse.

### Resolve Height Per Biome Candidate, Not Per Tile

The code should compute label height after biome regions are fetched, because each candidate has its own centroid. Tile-level height computation should not be reused for every biome region in that tile.

Alternatives considered:

- Keep a per-tile Z and only improve tile matching. This would still make multiple labels from the same tile share height and preserve much of the current artifact.

### Prefer Stable Fallbacks Over Disappearing Labels

When no loaded voxel tile can provide a local height, labels should still render with a stable fallback. The fallback can use current terrain-mode-style surface tile height or camera target height, but it should avoid making all visible labels share the same plane when better loaded height data exists nearby.

Alternatives considered:

- Hide labels without local voxel height. This would make label visibility dependent on voxel load timing and create flicker.
- Always raycast visible voxel meshes. This may be accurate but could be heavier than necessary for every refresh and should be considered only if available top-height metadata is too coarse.

### Keep API Contracts Stable Unless Needed

The initial implementation should not change `/api/biomes` or `/api/voxels` payloads. If implementation requires server-provided local surface heights, update architecture and client/server docs in the same change.

## Risks / Trade-offs

- Local voxel top-height metadata is coarse at chunk-column granularity -> labels may still float over steep slopes; mitigate by using the best available local column and keeping a small vertical offset.
- Loaded voxel data may be incomplete during camera movement -> labels may temporarily use fallback heights; mitigate by recomputing when voxel loads mark biome labels dirty.
- Raycasting exact geometry would be more accurate but potentially expensive -> start with metadata-based resolution and only escalate if visual quality is insufficient.
- Terrain underlay and voxel geometry may disagree in height -> prefer visible voxel data in voxel mode and use surface/terrain height only as fallback.
