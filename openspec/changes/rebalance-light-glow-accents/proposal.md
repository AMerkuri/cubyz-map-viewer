## Why

The mesh-local light spread now carries the desired surface illumination, but runtime glow sprites still create white-hot centers and hard bright lines that fight the Cubyz-like look. Source accents should preserve emitter color and remain secondary to the mesh lighting.

## What Changes

- Rework runtime glow sprites so their center is color-preserving rather than white-hot.
- Reduce sprite opacity, scale, and additive blowout so source highlights do not dominate nearby voxel surfaces.
- Rebalance or optionally disable point-light accents at lower quality settings if they cause artificial bright cores.
- Keep mesh-local emitted-light spread as the primary visible illumination model.
- Tune clustered emitters so multiple source accents combine softly without hard white seams or lines.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `block-emissive-lighting`: Runtime glow and point-light accents must remain color-preserving secondary highlights and must not introduce white-hot cores or hard visual lines that overpower mesh-local illumination.

## Impact

- Client block-light runtime, glow texture generation, optional point-light budgets/intensity, graphics quality behavior, and client documentation.
- No server payload or shared binary contract changes are expected.
