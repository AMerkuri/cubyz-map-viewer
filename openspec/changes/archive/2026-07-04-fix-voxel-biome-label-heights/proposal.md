## Why

Biome labels in voxel mode currently cluster onto a shared horizontal height level because their Z placement uses camera target height or whole voxel-region maximum height instead of a local height near each biome label. Terrain mode appears more natural because labels are placed from visible terrain tile mesh heights, so this change brings voxel-mode label placement closer to the visible world surface.

## What Changes

- Place voxel-mode biome labels using a local height estimate near each biome centroid instead of one tile-level or region-level Z value.
- Preserve terrain-mode biome label behavior unless shared helper code needs to be factored for consistency.
- Use loaded voxel geometry/top-height data when available, with a stable fallback when local voxel height cannot be resolved.
- Keep the existing `/api/biomes` payload shape unless implementation proves a client-only local height source is insufficient.

## Capabilities

### New Capabilities
- `biome-label-placement`: Defines expected biome label placement behavior across terrain and voxel view modes.

### Modified Capabilities

## Impact

- Affected client code: `src/client/features/world-view/lib/biome-labels.ts`, voxel tile metadata/types, and possibly voxel debug/top-height utilities.
- Affected runtime behavior: biome labels in voxel mode should visually follow nearby terrain/voxel elevation instead of forming a flat shelf.
- APIs: no planned HTTP contract change; docs updates are not expected unless the implementation changes `/api/biomes` or voxel payload contracts.
- Verification: default client TypeScript/lint checks; build only if worker or shared payload boundaries change.
