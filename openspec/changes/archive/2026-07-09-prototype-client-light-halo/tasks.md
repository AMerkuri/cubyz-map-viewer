## 1. Baseline And Scope

- [x] 1.1 Identify current client voxel mesh build inputs and where loaded neighbor emitter records can be gathered without server payload changes.
- [x] 1.2 Confirm the prototype is limited to LOD 1 loaded neighbor emitters and document any intentional gaps.

## 2. Client Halo Prototype

- [x] 2.1 Extend the client worker input or mesh queue data to accept extra nearby emitter records for a region build.
- [x] 2.2 Filter loaded neighbor emitters by emitted-light radius and region bounds before sending work to the voxel worker.
- [x] 2.3 Include extra halo emitters in the worker's emitter grid without changing server binary payload decoding.
- [x] 2.4 Refresh or rebuild already-loaded affected regions when newly loaded neighbor emitters can influence their border surfaces.

## 3. Tuning And Documentation

- [x] 3.1 Tune halo filtering, falloff, and candidate caps against the known torch/lava border scene.
- [x] 3.2 Update client documentation to describe the prototype client-side loaded-neighbor halo behavior if retained.
- [x] 3.3 Record whether the prototype validates moving to payload-owned halo lighting.

## 4. Verification

- [x] 4.1 Run `npm run check`.
- [x] 4.2 Run `npm run check:knip`.
- [x] 4.3 Run `npm run typecheck`.
- [x] 4.4 Run `npm run build` because this changes worker input and voxel mesh build boundaries.
- [x] 4.5 Manually verify the region-border night scene no longer shows a hard line after both neighboring regions are loaded.
