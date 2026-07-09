## 1. Server Emitted-Light Metadata

- [x] 1.1 Extend block visual metadata scanning to read numeric `.emittedLight` from layered Cubyz block definitions without using `*_emission.png` filename inference.
- [x] 1.2 Add palette-indexed emitted-light storage to the server block color/visual table and expose RGB byte values to voxel generation.
- [x] 1.3 Include emitted-light metadata in source signatures or voxel cache validity so asset override changes invalidate stale payloads.

## 2. Voxel Payload And Generation

- [x] 2.1 Define a versioned compact emitter-record section in the `/api/voxels` binary payload and update wire-format helpers and metrics accordingly.
- [x] 2.2 Collect LOD 1 emitter records while generating voxel meshes for blocks whose palette index has non-zero emitted light.
- [x] 2.3 Ensure LODs greater than 1 omit per-block emitter records and represent empty emitter sets without separate requests.
- [x] 2.4 Bump voxel generator cache version and keep `VoxelMeshService` response caching, ETags, and compression variants consistent with the new payload.

## 3. Client Decode And Region Lifecycle

- [x] 3.1 Extend shared client worker types to carry decoded emitter records with voxel worker output and pending voxel mesh items.
- [x] 3.2 Decode the emitter section in the voxel worker for current payloads while keeping stale/legacy payload handling safe.
- [x] 3.3 Store emitter metadata on loaded voxel tiles and remove or replace region-owned emitter effects when regions unload, refresh, or change LOD.

## 4. Block-Light Rendering

- [x] 4.1 Add an imperative block-light runtime manager under the world-view feature that owns scene objects and keeps per-frame state out of React.
- [x] 4.2 Render a bounded nighttime emitter effect using self-lit/glow-tinted presentation and a capped local-light or glow-object budget.
- [x] 4.3 Prioritize or degrade emitter rendering when loaded emitter counts exceed the active budget while preserving scene responsiveness.
- [x] 4.4 Ensure disabled or unsupported block-emissive lighting falls back to existing atmosphere, vertex colors, AO, and scene lighting without errors.

## 5. Controls, Debugging, And Atmosphere Integration

- [x] 5.1 Add graphics/debug settings for block-emissive lighting enablement or quality using existing world-controls persistence patterns.
- [x] 5.2 Tune low-light atmosphere behavior so local block emitters remain useful without raising global ambient light to daytime readability.
- [x] 5.3 Expose useful debug/metrics fields for decoded emitter counts, active rendered emitters, and budget/degradation state.

## 6. Documentation And Verification

- [x] 6.1 Update `docs/architecture-overview.md` for the shared voxel payload contract and emitter record semantics.
- [x] 6.2 Update `docs/server-specification.md` for `.emittedLight` parsing, emitter payload generation, cache validity, and metrics.
- [x] 6.3 Update `docs/client-specification.md` for worker decode behavior, region-owned emitter lifecycle, controls, and bounded rendering semantics.
- [x] 6.4 Run `npm run check && npm run check:knip && npm run typecheck`.
- [x] 6.5 Run `npm run build` because this change touches route payloads, worker protocol, and TypeScript boundaries.
- [ ] 6.6 Manually inspect a low-light world area containing at least torches or lava to confirm emitters improve readability and disabled settings preserve the previous rendering path.
