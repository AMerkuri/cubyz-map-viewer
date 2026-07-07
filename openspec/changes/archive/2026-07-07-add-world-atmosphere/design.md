## Context

The 3D world view already creates a Three.js scene with a fixed dark background, ambient light, hemisphere light, main directional sun, and fill directional light. Terrain and voxel readability comes primarily from vertex colors, Lambert materials, and precomputed face shading, so the atmosphere work needs to enhance the scene without replacing the existing block-readable visual language.

The Phase 1 bundle is client-only. It should live near the existing world-view scene runtime and keep per-frame scene state in imperative Three.js objects rather than React state. If user-facing atmosphere settings are exposed, control state can be composed through the existing world-controls/app wiring, but server APIs and Cubyz file contracts should remain unchanged.

## Goals / Non-Goals

**Goals:**

- Add a coherent atmosphere layer made from time-of-day lighting, stylized sky colors, subtle depth enhancement, and optional sun-shaft accents.
- Preserve Cubyz authenticity by favoring readable silhouettes, chunky/stylized gradients, and restrained contrast over physically realistic rendering.
- Keep implementation modular enough for later rendering phases without requiring them now.
- Keep scene updates efficient for orbiting and flying through large terrain/voxel views.

**Non-Goals:**

- Do not add raymarched volumetric clouds in Phase 1.
- Do not add cascaded shadow maps, PCSS contact-hardening shadows, temporal AA, or screen-space water reflection/refraction in Phase 1.
- Do not change server payloads, WebSocket events, voxel worker protocols, Cubyz parsers, or world save interpretation.
- Do not make atmosphere simulation authoritative or tied to real Cubyz world time unless a future change introduces that contract.

## Decisions

### Decision: Treat Phase 1 as one world-atmosphere capability

The time-of-day value drives sun direction, light colors, sky colors, and sun-shaft visibility, so these pieces should be specified and implemented as one user-visible atmosphere capability.

Alternatives considered:
- Split into separate day-night, sky, SSAO, and god-rays capabilities. This makes sense only if they become independently shippable product surfaces; for Phase 1 it would add coordination overhead and obscure the unified visual goal.
- Create a generic rendering-quality capability. This is too broad and would mix atmosphere with later high-cost rendering features.

### Decision: Use stylized scene-layer atmosphere before heavy post-processing

Start with a sky/background treatment, light color/intensity changes, and a subtle depth enhancement pass or equivalent scene treatment that preserves block contrast. Keep any sun shafts stylized and optional, especially near sunrise/sunset angles.

Alternatives considered:
- Adopt a physically based sky/atmosphere stack. This would raise visual ambition but risks clashing with the current vertex-colored Cubyz style.
- Move immediately to full post-processing composition. This may be needed for SSAO or sun shafts, but the design should avoid making every Phase 1 element dependent on a complex EffectComposer pipeline if simpler scene-level rendering is enough.

### Decision: Keep atmosphere state client-local and configurable

Atmosphere should default to a stable, readable presentation and optionally expose a visual time-of-day control or preset. The value is a viewer presentation setting, not a server/world contract.

Alternatives considered:
- Bind time of day to the Cubyz save or server. There is no current shared contract for world time in the viewer, so this would expand scope into server/API behavior.
- Run a mandatory real-time cycle only. A purely automatic cycle can be distracting for map inspection; users need predictable readability.

### Decision: Design future phases as extensions, not hidden Phase 1 requirements

Future rendering phases can build from this foundation:

- Phase 2: stylized water reflection/refraction if water surfaces are represented clearly enough in the viewer.
- Phase 3: rendering quality pipeline work such as temporal AA and selective post-processing presets.
- Phase 4: shadow pipeline work such as cascaded shadow maps and possibly PCSS if it preserves block readability.
- Phase 5: volumetric cloud experiments, ideally stylized and optional rather than mandatory realism.

These phases should be referenced in documentation/design notes but not implemented as part of this change.

## Risks / Trade-offs

- Atmosphere could reduce terrain and voxel readability -> Keep default contrast conservative, avoid muddy SSAO, and verify labels/markers remain legible across times of day.
- Post-processing could add performance cost on large scenes or high-DPI displays -> Make expensive effects optional or quality-scaled and preserve a low-cost baseline.
- Sun shafts or depth effects could feel generic rather than Cubyz-authentic -> Favor block-friendly gradients, restrained opacity, and low-frequency stylization over cinematic bloom-heavy effects.
- Adding controls could clutter the HUD -> Prefer minimal presets or debug controls unless a full user-facing control proves necessary.
- Future phases may need a different render pipeline -> Keep Phase 1 atmosphere code modular around scene setup/render hooks so later EffectComposer or shader passes can be added without rewriting core terrain/voxel loading.

## Migration Plan

This is a client-only visual enhancement. Rollout can be done by adding the atmosphere layer behind defaults that match or improve the current fixed-lighting view. Rollback is removing or disabling the atmosphere initialization and returning to the existing fixed background and lights.

Documentation should be updated if the implementation adds user-facing controls, persisted settings, or a new visual mode description.

## Open Questions

- Should the first implementation expose time of day as a user-facing control, a debug-only control, or a fixed preset set?
- Should subtle depth enhancement use SSAO-style post-processing, geometry/vertex-color adjustments, or a cheaper distance/fog-like treatment first?
- What is the minimum acceptable performance target for atmosphere effects on integrated GPUs and high-DPI displays?
