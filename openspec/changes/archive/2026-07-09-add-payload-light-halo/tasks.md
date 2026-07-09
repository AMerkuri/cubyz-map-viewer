## 1. Payload Design

- [x] 1.1 Choose the emitter halo coordinate representation for emitters outside region-local unsigned coordinates.
- [x] 1.2 Update binary payload versioning and cache signatures if the emitter record layout or interpretation changes.
- [x] 1.3 Define halo record bounds, radius filtering, and maximum records per payload.

## 2. Server Generation

- [x] 2.1 Extend voxel generation to discover neighboring-region emitters that can affect requested-region visible geometry.
- [x] 2.2 Encode own-region and halo emitter records in the voxel payload with deterministic ordering.
- [x] 2.3 Update voxel metrics/stats to report own or total emitter records clearly enough for debugging.

## 3. Client Decode And Rendering

- [x] 3.1 Update the client voxel worker decoder for the halo-capable emitter record format.
- [x] 3.2 Bake mesh-local emitted light from payload-owned own-region and halo records.
- [x] 3.3 Ensure runtime glow and point-light ownership remains stable when halo records are present.

## 4. Documentation

- [x] 4.1 Update `docs/architecture-overview.md` for the halo payload contract.
- [x] 4.2 Update `docs/server-specification.md` for voxel generation, cache, and emitter payload behavior.
- [x] 4.3 Update `docs/client-specification.md` for halo decode and mesh-local rendering behavior.

## 5. Verification

- [x] 5.1 Run `npm run check`.
- [x] 5.2 Run `npm run check:knip`.
- [x] 5.3 Run `npm run typecheck`.
- [x] 5.4 Run `npm run build` because this changes route payload and worker decode boundaries.
- [ ] 5.5 Manually verify adjacent loaded regions show continuous mesh-local emitted light at borders without relying on client load-order rebakes.
