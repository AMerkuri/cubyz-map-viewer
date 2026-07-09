## Why

The current block-emissive lighting implementation reads as sparse decorative point lights over a near-black scene, while Cubyz night lighting preserves world readability and makes emitted blocks feel integrated into nearby voxel surfaces. Improving this now builds on the existing emitter metadata pipeline and closes the visible gap between the viewer and the game.

## What Changes

- Replace the current point-light-first presentation with a Cubyz-like local illumination model where emitted blocks affect nearby voxel face colors or equivalent baked mesh lighting.
- Preserve a low-intensity night baseline so terrain, vegetation, and voxel silhouettes remain readable without making night look like daytime.
- Keep runtime block-light effects bounded and quality-controlled, with point lights and glow sprites treated as accents rather than the primary lighting model.
- Ensure emitted-light changes participate in voxel payload/cache validity when light-field or baked-light semantics change.
- Update client/server documentation for any payload, worker, cache, or rendering-flow changes.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `block-emissive-lighting`: Strengthen the existing bounded approximation requirement so emitted blocks illuminate nearby voxel surfaces through Cubyz-like local lighting instead of relying mainly on sparse dynamic point lights and glow sprites.
- `world-atmosphere`: Refine low-light atmosphere requirements so night keeps a readable ambient/skylight floor while preserving local emitter contrast.

## Impact

- Client voxel worker color generation in `src/client/features/world-view/workers/voxel-mesh.worker.ts`.
- Client scene/runtime lighting in `src/client/features/world-view/lib/atmosphere.ts`, `src/client/features/world-view/lib/block-light-runtime.ts`, and `src/client/features/world-view/lib/scene-runtime.ts`.
- Server voxel payload generation and cache signatures if baked/local light data requires additional payload semantics or cache invalidation in `src/server/services/voxel-generator.ts`, `src/server/services/greedy-mesh.ts`, `src/server/services/block-color-table.ts`, and `src/server/services/voxel-mesh-service.ts`.
- Existing graphics/debug settings and stats for atmosphere and block-light quality.
- Documentation in `docs/client-specification.md`, `docs/server-specification.md`, and `docs/architecture-overview.md` if shared voxel payload or runtime flow changes.
