## 1. Payload Design

- [ ] 1.1 Choose the emitter halo coordinate representation for emitters outside region-local unsigned coordinates.
- [ ] 1.2 Update binary payload versioning and cache signatures if the emitter record layout or interpretation changes.
- [ ] 1.3 Define halo record bounds, radius filtering, and maximum records per payload.

## 2. Server Generation

- [ ] 2.1 Extend voxel generation to discover neighboring-region emitters that can affect requested-region visible geometry.
- [ ] 2.2 Encode own-region and halo emitter records in the voxel payload with deterministic ordering.
- [ ] 2.3 Update voxel metrics/stats to report own or total emitter records clearly enough for debugging.

## 3. Client Decode And Rendering

- [ ] 3.1 Update the client voxel worker decoder for the halo-capable emitter record format.
- [ ] 3.2 Bake mesh-local emitted light from payload-owned own-region and halo records.
- [ ] 3.3 Ensure runtime glow and point-light ownership remains stable when halo records are present.

## 4. Documentation

- [ ] 4.1 Update `docs/architecture-overview.md` for the halo payload contract.
- [ ] 4.2 Update `docs/server-specification.md` for voxel generation, cache, and emitter payload behavior.
- [ ] 4.3 Update `docs/client-specification.md` for halo decode and mesh-local rendering behavior.

## 5. Verification

- [ ] 5.1 Run `npm run check`.
- [ ] 5.2 Run `npm run check:knip`.
- [ ] 5.3 Run `npm run typecheck`.
- [ ] 5.4 Run `npm run build` because this changes route payload and worker decode boundaries.
- [ ] 5.5 Manually verify adjacent loaded regions show continuous mesh-local emitted light at borders without relying on client load-order rebakes.
