## 1. Shape Metadata

- [x] 1.1 Add `cubyz:texture_pile` to the supported semantic rotation metadata model.
- [x] 1.2 Parse texture-pile `.model = .{ .model, .states }` definitions into referenced model geometry and finite state metadata.
- [x] 1.3 Include texture-pile model references, state counts, and semantic support versioning in block shape signatures.
- [x] 1.4 Preserve fallback diagnostics for malformed texture-pile definitions or missing model assets.

## 2. Voxel Geometry

- [x] 2.1 Emit LOD 1 texture-pile blocks as referenced model quads instead of full cube geometry.
- [x] 2.2 Clamp or safely handle texture-pile block data values outside the configured state count.
- [x] 2.3 Add an angle-based transform path for sign floor and ceiling variants so data `0..15` maps to 45-degree increments.
- [x] 2.4 Verify and preserve sign side variant mapping for data `16..19` to `-X`, `-Y`, `+X`, and `+Y` attachments.
- [x] 2.5 Invalidate stale voxel cache entries for the changed semantic geometry behavior.

## 3. Documentation

- [x] 3.1 Update `docs/architecture-overview.md` for expanded server-side semantic shape handling.
- [x] 3.2 Update `docs/server-specification.md` for `cubyz:texture_pile`, eight-way sign orientation, and cache invalidation behavior.
- [x] 3.3 Keep glass/translucent rendering out of documentation scope except as an explicit non-goal if needed.

## 4. Verification

- [x] 4.1 Run `npm run check`.
- [x] 4.2 Run `npm run check:knip`.
- [x] 4.3 Run `npm run typecheck`.
- [x] 4.4 Run `npm run build` because voxel worker/server TypeScript boundaries and generated payload behavior are affected.
- [x] 4.5 Manually verify in voxel view that red/dead/yellow leaf piles render as plane-style geometry and sign floor/ceiling placements show eight distinct orientations.
