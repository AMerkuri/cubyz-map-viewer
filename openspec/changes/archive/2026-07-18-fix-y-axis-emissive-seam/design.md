## Context

The server supplies LOD 1 payloads with exact own-region emitter records plus halo records from neighboring regions. The client worker bakes those records into per-vertex emissive attributes. At the `Y = 5632` seam between live regions `768/5504` and `768/5632`, the receiving south payload contains the relevant north halo sources, yet matching boundary vertices receive materially different emitted-light values.

The regression is client-side and persists in one-phase meshing. The current `accumulateEmitterLight` path probes a vertex's primary spatial-grid cell first and only searches adjacent cells when that primary cell has no reachable candidate. Because each payload has different unrelated own and halo records, this shortcut makes candidate discovery data-dependent at a region border. The existing seam contract fixture covers an X-axis seam but not this asymmetric Y-axis case.

## Goals / Non-Goals

**Goals:**

- Make the worker evaluate every eligible in-radius emitter for a vertex regardless of its owning payload region or spatial-grid primary-cell population.
- Retain bounded per-vertex candidate work and deterministic nearest-candidate selection.
- Add hermetic regression coverage for a Y-axis LOD 1 seam with asymmetric unrelated emitter populations.
- Preserve all existing binary payload, server halo, runtime-accent, and graphics-control behavior.

**Non-Goals:**

- Change server halo collection, emitter ownership flags, payload encoding, cache keys, or source qualification.
- Change emitted-light radius, falloff, open-face transmission, source power, or runtime glow and point-light budgets.
- Redesign coarse LOD emitter aggregation or the progressive enhancement lifecycle.
- Use a real save, browser, WebGL context, or running server in the regression test.

## Decisions

### Use an unconditional bounded neighboring-cell probe

`accumulateEmitterLight` will gather deduplicated candidates from the complete fixed neighboring-cell footprint needed by the configured falloff radius, rather than treating a reachable primary-cell entry as permission to skip the other cells. The existing radius-aware insertion coverage and candidate stamps remain in place; the nearest-candidate cap still bounds final per-vertex evaluation.

The primary-cell shortcut is rejected because its result depends on unrelated records that happen to share the receiver's cell. Increasing insertion margins alone is rejected because it cannot guarantee that a skipped adjacent cell is semantically irrelevant. A global linear scan is rejected because it removes the worker's spatial bound for dense payloads.

### Test an asymmetric Y-axis seam through production paths

The regression fixture will generate adjacent LOD 1 regions across a Y boundary. It will place matching cross-boundary emitters and receivers around the seam, while adding unrelated emitters only on one side so the candidate grid populations differ. The test will generate production payloads, decode them with the production worker, collect shared Y-seam vertices by world position and normal, and require normalized emissive agreement within compact-attribute encoding tolerance.

The existing X-axis fixture remains valuable but cannot expose the data-dependent Y-axis case. A worker-only hand-built payload is rejected because it would fail to exercise halo ownership and production encoding.

### Preserve current server and shader contracts

The repair is limited to candidate discovery before the existing falloff, directional transmission, power gain, compact encoding, and shader upload. The server already transports the relevant halo records for the observed seam, so changing its payload format or cache identity would add unrelated risk.

## Risks / Trade-offs

- [More candidate-cell reads per lit vertex] -> Keep the probe fixed to the radius-compatible neighboring-cell footprint, reuse candidate stamps and scratch arrays, and retain the nearest-candidate cap.
- [Duplicate candidates from radius-expanded cell insertion] -> Continue exact-once candidate-stamp deduplication before distance ranking.
- [Fixture passes while another directional seam fails] -> Structure seam helpers around the horizontal axis so an X counterpart can share the same collection and comparison mechanics; keep current X coverage.
- [Repair masks a server halo regression] -> The test continues to generate both adjacent production payloads and asserts seam output only when the server supplies the required halo source.

## Migration Plan

1. Add the asymmetric Y-axis regression first and confirm it fails against the current candidate shortcut.
2. Replace the shortcut with bounded complete neighboring-cell candidate discovery.
3. Run the focused voxel seam and worker suites, then the default checks and build.
4. Update client and architecture documentation to state that region ownership and unrelated local emitters cannot alter in-radius seam contributions.

No API, persisted-data, cache, deployment, or user migration is required. Rollback is a client-worker reversion, but would restore the hard LOD 1 seam.

## Open Questions

None. The failing live seam has verified own/halo source equivalence and isolates the change to client candidate discovery.
