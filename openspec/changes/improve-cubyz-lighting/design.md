## Context

The current block-emissive pipeline already reads Cubyz `.emittedLight` metadata, emits compact LOD 1 emitter records in voxel payloads, decodes those records in the client voxel worker, and reconciles runtime effects through `BlockLightRuntimeManager`. The visible result is still weaker than Cubyz because local light is mostly represented as capped `PointLight`s and glow sprites over `MeshLambertMaterial` voxel meshes with baked vertex colors.

The comparison images show the mismatch: Cubyz preserves a readable night baseline and makes emitted blocks illuminate nearby voxel surfaces, while the viewer crushes much of the scene toward black and creates isolated bright pools. The implementation should therefore make emitted light part of voxel surface presentation rather than primarily adding more dynamic scene lights.

## Goals / Non-Goals

**Goals:**

- Render emitted block light as local color contribution on nearby voxel surfaces, approximating Cubyz' voxel light-field look.
- Preserve night readability through a low-intensity ambient/skylight floor without turning night into daytime.
- Keep the system bounded for large loaded scenes by limiting expensive runtime accents and avoiding unbounded Three.js light counts.
- Preserve existing React/Three.js layering: per-frame lighting/runtime state stays in imperative world-view modules, not React state.
- Keep existing emitter metadata and LOD 1 ownership semantics unless a later implementation step proves a payload extension is necessary.
- Update docs and cache/version semantics if light presentation becomes part of shared payload or persisted mesh interpretation.

**Non-Goals:**

- Exact Cubyz engine light propagation parity.
- Full dynamic shadows, cascaded shadow maps, screen-space GI, bloom post-processing, or volumetric lighting.
- Runtime relighting of unloaded regions or coarser LODs beyond existing emitter availability.
- Making point lights the main solution by simply raising budgets or intensities.

## Decisions

### Decision: Treat mesh-local emitted-light color as the primary effect

The primary emitted-light effect should be added during voxel mesh color construction, using emitter records to tint nearby vertices or face colors with a bounded falloff. `BlockLightRuntimeManager` should remain responsible for optional accents such as source glow sprites and a small capped point-light pool.

Alternatives considered:

- Increase point-light budgets and intensities. Rejected because it would create more bright blobs without making voxel faces carry Cubyz-like local illumination.
- Add post-processing bloom first. Rejected because bloom improves source sparkle but not terrain/voxel light integration.
- Implement exact propagation first. Deferred because it is higher-risk and may require block-opacity volume access, cross-region light exchange, and more cache/protocol work than needed for the first meaningful visual improvement.

### Decision: Start from existing LOD 1 emitter records

The first implementation should use already-decoded LOD 1 emitter records and loaded tile ownership to compute local contribution for visible voxel geometry. This avoids a new route, new WebSocket event, or mandatory payload extension at the start of the change.

The implementation can still adjust voxel cache signatures if generated payload interpretation changes. If the chosen implementation moves light-field generation server-side or encodes additional data, it must version the payload/cache and update docs.

Alternatives considered:

- Add a separate `/api/lights` endpoint. Rejected for now because emitter records already travel with voxel payloads and unload with tile lifecycle.
- Encode a full light volume in every voxel payload. Deferred because it increases payload size and generation complexity before proving the visual model.

### Decision: Use a Cubyz-like bounded falloff, not physically realistic lighting

The local-light contribution should be stylized and block-readable: warm/cool emitter color should spread over nearby surfaces with a soft but bounded radius, and contribution should avoid washing block colors to white. A simple distance falloff with tuned color scaling is acceptable for the first implementation; exact occlusion-aware propagation is optional future refinement.

Alternatives considered:

- Use Three.js physically correct point-light behavior. Rejected because the target is Cubyz-style voxel readability, not photographic lighting.
- Require occlusion-aware flood fill immediately. Deferred because it is more faithful but more expensive and needs careful access to source voxel occupancy across region boundaries.

### Decision: Rebalance night atmosphere around emitter contrast

Night atmosphere should retain a low ambient/skylight floor so terrain, vegetation, and voxel silhouettes are visible, while local emitters remain important. This means reducing near-black crushing and making global night color more Cubyz-like, not simply raising all light intensities.

Alternatives considered:

- Leave atmosphere unchanged and only strengthen emitters. Rejected because the comparison shows the viewer baseline is too black, causing emitters to appear detached.
- Raise ambient to daytime-like readability. Rejected because it would remove the visual purpose of night and reduce emitter contrast.

### Decision: Keep debug quality semantics but make degradation less visible

`blockLightQuality` should continue to control cost. Lower quality may disable or reduce mesh-local contribution and runtime accents, but high emitter counts should degrade optional accents first. Surface illumination for already-built loaded geometry should not depend on an unbounded point-light pool.

Alternatives considered:

- Tie all local illumination to the existing point-light budget. Rejected because budget pressure is part of the current visual failure.
- Remove quality controls. Rejected because large worlds can contain many emitters and mobile/low-power devices need bounded work.

## Risks / Trade-offs

- Mesh-local light computed only from same-tile emitters could visibly stop at region boundaries -> Include neighboring loaded-region emitters where feasible or tune radius/falloff so boundary artifacts are limited.
- Non-occluded distance falloff can light through walls -> Keep the first pass visually conservative, then consider optional voxel-grid propagation if artifacts are obvious.
- Additional worker computation can increase decode time -> Gate by quality, prefilter emitters by radius, cap emitter candidates per tile/quadrant, and measure worker decode timing in existing stats.
- Raising night baseline can reduce nighttime mood -> Tune ambient/skylight colors toward dark green/blue and keep emitter contrast stronger than the baseline.
- Changing payload semantics can reuse stale persisted meshes -> Bump the relevant cache/version signature whenever baked/local light data or interpretation becomes persisted.
- Strong additive color can wash out block identity -> Clamp contribution and blend multiplicatively/additively in a way that preserves base block hue and AO.

## Migration Plan

1. Implement the client-side visual model behind existing atmosphere and block-light quality settings.
2. Tune night baseline and emitter contribution against the known comparison scene.
3. If implementation changes voxel payload or persisted mesh interpretation, bump cache/version signatures and update architecture/client/server docs in the same change.
4. Preserve existing disabled behavior: quality `0` paths continue rendering without emitted-light contribution.
5. Rollback is straightforward by disabling the new mesh-local contribution and returning runtime accents to the previous point-light/sprite behavior.

## Open Questions

Resolved during implementation:

- Occlusion: the first implementation uses conservative non-occluded smoothstep falloff with a wrapped lambert term; occlusion-aware propagation remains future refinement.
- Neighboring tile emitters: mesh-local contribution uses same-tile emitter records only. The worker decodes one region payload at a time, server flood-fill already includes cross-chunk emitters within the region, and the bounded radius (15 blocks vs 128-block regions) keeps boundary artifacts limited.
- Default quality settings: unchanged (`atmosphereQuality: 1`, `blockLightQuality: 1`). Quality now gates the mesh-light uniform plus accent budgets instead of the primary lighting model.
- Transparent voxels: excluded from mesh-local emitted light to preserve accumulated-tint readability; they keep the existing scene-light presentation and runtime accents.
- Payload/cache: no server payload or cache signature change was needed; the emitted-light presentation is baked at client decode time from existing emitter records, and the client has no persisted mesh cache.
