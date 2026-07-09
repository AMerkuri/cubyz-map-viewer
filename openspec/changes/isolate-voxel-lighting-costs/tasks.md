## 1. Diagnostic Matrix Wiring

- [ ] 1.1 Add debug-only state or configuration for the two independent matrix switches: server halo emitters enabled/disabled and client emissive attributes enabled/disabled.
- [ ] 1.2 Preserve current behavior as the default matrix state with both halo emitters and emissive attributes enabled.
- [ ] 1.3 Reset or separate voxel benchmark samples when the active diagnostic matrix state changes.

## 2. Server Halo Cost Isolation

- [ ] 2.1 Thread the halo-emitter diagnostic state through voxel requests and `VoxelMeshService` without bypassing the normal voxel route/service layering.
- [ ] 2.2 Make halo-disabled diagnostic payload generation omit neighboring-region halo emitter collection while preserving own-region emitter records.
- [ ] 2.3 Prevent halo-disabled diagnostic payloads from contaminating normal persistent voxel cache entries or being hidden by normal cached payloads.
- [ ] 2.4 Add server metrics for own emitter count, halo emitter count, and halo-specific generation timing or equivalent phase timing.

## 3. Client Emissive Cost Isolation

- [ ] 3.1 Thread the emissive-attribute diagnostic state to the voxel worker without changing default block-light rendering behavior.
- [ ] 3.2 Make emissive-disabled diagnostic decoding skip mesh-local emissive attribute allocation, baking, transfer, and geometry upload while still decoding payload geometry and emitter records needed for lifecycle/runtime stats.
- [ ] 3.3 Add client worker benchmark metrics for emissive attribute bytes and any additional bake/output timing needed to interpret worker decode cost.
- [ ] 3.4 Show the active diagnostic matrix state and new metrics in the debug stats UI.

## 4. Documentation

- [ ] 4.1 Update `docs/client-specification.md` with the debug-only client emissive diagnostic behavior and benchmark metric interpretation.
- [ ] 4.2 Update `docs/server-specification.md` with halo diagnostic behavior, cache-safety expectations, and server metric interpretation.
- [ ] 4.3 Update `docs/architecture-overview.md` if the diagnostic controls or metrics become part of the documented client/server debug contract.

## 5. Verification And Measurement

- [ ] 5.1 Run `npm run check`.
- [ ] 5.2 Run `npm run check:knip`.
- [ ] 5.3 Run `npm run typecheck`.
- [ ] 5.4 Run `npm run build` because this touches server payload behavior and the client voxel worker boundary.
- [ ] 5.5 Manually run the four matrix cells on the known slow scene and record server generation timing, worker decode timing, worker output bytes, emissive bytes, loaded chunk count, and FPS.
