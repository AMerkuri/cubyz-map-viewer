## Context

The current viewer has a client-local atmosphere system that changes sky, fog, ambient light, hemisphere light, sun light, and fill light based on time-of-day. Voxel readability still comes mainly from server-provided block colors, client-side baked face tinting, AO, and `MeshLambertMaterial` scene lighting. At night the global atmosphere can make the scene dark, but the voxel payload carries no information about Cubyz blocks that should emit local light.

Cubyz represents actual block light sources with `.emittedLight = 0xRRGGBB` in block `.zig.zon` definitions. The game loads that value into `Block.light()` and seeds RGB block-light propagation from blocks whose light is non-zero. Cubyz also supports `*_emission.png` textures, but those are material self-illumination masks in shaders, not the authoritative source for emitted block-light color or intensity.

The map viewer already scans layered block definitions for color, transparency, absorption, model references, and supported rotation/semantic metadata. The voxel generator already has access to block palette indices and full block values while walking region data, and the client worker already decodes a versioned binary voxel payload into retained per-region metadata. This makes `.emittedLight` a natural extension of the existing palette-indexed metadata and voxel payload contract.

## Goals / Non-Goals

**Goals:**

- Use Cubyz `.emittedLight` metadata as the authoritative source of block-emitter color.
- Include compact LOD 1 emitter records in voxel payloads so torches, lava, lamps, glow crystals, luminous plants, and similar blocks can affect nighttime map readability.
- Keep the first rendering path bounded and map-friendly: emissive blocks remain visible, and nearby emitters can add local glow or a capped number of dynamic lights without full Cubyz propagation parity.
- Preserve existing voxel geometry behavior, hover identity, transparent rendering, and region cache invalidation semantics.
- Add controls or quality gating so the effect can be reduced or disabled.
- Document the shared payload and client/server responsibilities.

**Non-Goals:**

- Exact Cubyz light propagation, colored absorption simulation, or save-game lightmap parity.
- Dynamic shadows, cascaded shadow maps, physically based light attenuation, or ray tracing.
- Texture-accurate emissive masks from `*_emission.png` in the first version.
- Emitting lights for coarser LODs unless a future design defines aggregation behavior.
- Inferring emitters from block ID names or texture filenames when `.emittedLight` is absent.

## Decisions

1. Use `.emittedLight` as authoritative emitter metadata.

   The server should extend block visual metadata scanning to read numeric `.emittedLight` from layered block definitions and build a palette-indexed table. Values are decoded as RGB bytes from `0xRRGGBB`, matching Cubyz `extractColor()` behavior.

   Alternative considered: infer emitters from `*_emission.png` files. This is rejected because Cubyz uses emission textures for visual self-illumination, while `.emittedLight` controls actual block-light sources. Filename inference would miss authoritative intensity/color semantics and could produce false positives for lit-state textures.

2. Emit compact per-block light records for LOD 1 voxel regions.

   The voxel generator should collect records for non-air block values whose palette index has non-zero emitted light. Each record should include block-local or region-local integer coordinates plus RGB light color. Records should be attached to the same `/api/voxels` response as the mesh so emitter lifecycle follows loaded voxel regions and existing invalidation paths.

   Alternative considered: add a separate `/api/lights` route. This keeps mesh payloads smaller but duplicates region fetch/invalidation logic and increases coordination complexity. Since lights are region-owned and derived from the same block scan as geometry, embedding them in the voxel payload is simpler and harder to desynchronize.

3. Version the voxel payload and cache when emitter records are added.

   Adding emitter sections changes the client/server binary contract and persistent mesh cache validity. The payload header/layout and `VOXEL_GENERATOR_CACHE_VERSION` should distinguish emitter-aware payloads from previous geometry-only payloads. ETags and encoded variants continue to be owned by `VoxelMeshService`.

   Alternative considered: append records only when present and rely on trailing byte detection. This is fragile for stale caches and makes worker decode less explicit. A versioned layout is safer.

4. Render a bounded approximation instead of full propagation.

   The client should treat emitter records as presentation data. The first implementation should make emitting blocks visually self-lit and add local nighttime glow using a capped mechanism: for example glow sprites, lightweight unlit quads, or a small nearest-to-camera/focus pool of `PointLight`s. The effect should be reduced when atmosphere quality is low or block-light quality is disabled.

   Alternative considered: simulate Cubyz RGB propagation in the viewer. This would require neighborhood-aware volumetric light data, absorption handling, and substantial payload or compute cost. It is out of proportion for a map viewer and can be considered later if the approximation is insufficient.

5. Keep emitter scene state imperative and region-owned.

   Emitter objects should be reconciled inside the world-view runtime as voxel regions load, unload, refresh, or change LOD. Per-frame emitter selection and light pooling should stay in refs/runtime managers rather than React state, matching `World3DView.tsx` conventions.

   Alternative considered: store decoded emitters in React state. This would increase render churn and fight the existing imperative Three.js runtime model.

## Risks / Trade-offs

- [Risk] Dense builds or lava fields may contain many emitters. → Mitigation: cap dynamic lights, prefer cheap emissive/glow rendering, report emitter counts in debug metrics, and provide a quality/disable control.
- [Risk] Payload size and worker decode cost increase. → Mitigation: use compact integer records, emit only LOD 1 records initially, include cache/version metrics, and avoid per-face propagation data.
- [Risk] Approximate lighting may not match Cubyz exactly. → Mitigation: document that viewer block lighting is map-friendly and uses `.emittedLight` colors without full propagation parity.
- [Risk] Real `PointLight`s can interact unpredictably with large Lambert meshes and transparent geometry. → Mitigation: keep point lights optional/capped and make emissive face/glow readability the baseline.
- [Risk] Existing atmosphere defaults could still be too dark or too bright. → Mitigation: tune low-light atmosphere around local block emitters and keep quality `0`/disabled fallbacks available.
- [Risk] Save asset overrides change emitted light values. → Mitigation: include emitted-light metadata in source signatures/cache validity so restarted servers rebuild affected payloads.
