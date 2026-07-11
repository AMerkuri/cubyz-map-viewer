## Context

LOD1 payloads combine own-region emitters with server-collected neighboring halo emitters before the browser worker bakes `emissiveLight` attributes. `capEmitterRecords()` limits this combined set to 8,192 records. Its current edge reservation ranks candidates against a broad receiving volume and deterministic coordinates, so dense records at the same edge distance can displace emitters that are close to actual visible geometry at a particular Y/Z location.

At the `1/640/5376` to `1/768/5376` seam, matching vertex `(768, 5424, 37)` receives 0.059 normalized emitted light in the west mesh and 0.345 in the east mesh. Six east-owned emitters within the 12-block falloff radius are omitted from the west payload under cap pressure. Injecting only those records raises the west bake to 0.349. The client worker correctly bakes records it receives; payload retention is incomplete.

## Goals / Non-Goals

**Goals:**

- Retain all cap-eligible halo sources required to light visible boundary geometry, within the existing bounded payload budget.
- Keep selection deterministic, preserve normal uncapped payload behavior, and avoid sending every neighboring emitter.
- Preserve binary record layout, halo semantics, and client request flow.
- Validate source selection and exact browser-worker emissive continuity at matching LOD1 seam vertices.

**Non-Goals:**

- Reintroducing client-owned neighbor emitter discovery as the primary halo mechanism.
- Changing emitted-light color, falloff, open-face transmission, point-light accents, or the global record-cap budget.
- Treating all neighboring regions as affected or rebuilding unrelated loaded meshes.

## Decisions

### Decision 1: Rank capped halo candidates against visible boundary geometry

When the LOD1 cap is exceeded, derive receiving boundary samples from the generated opaque quads and evaluate each halo candidate against the surfaces it can reach under the same world-space radius used by the client bake. Reserve or rank candidates by minimum distance to those samples, scoped to the edge or corner they cross.

This replaces broad-volume relevance, which considers unrelated emitters equally relevant when their perpendicular edge distance and vertical range tie. The approach preserves the small set of sources that can affect the actual receiving mesh.

- Alternative: raise or remove the 8,192 cap. Rejected because payload transfer, worker allocation, and bake cost become unbounded in dense regions.
- Alternative: supplement the server payload from client-loaded neighbors. Rejected as the primary solution because it restores timing-dependent lighting and only repairs a seam after the neighbor finishes loading.

### Decision 2: Make the cap fallback geometry-aware only under pressure

Uncapped payloads retain their current deterministic ordering. Geometry-aware candidate selection runs only when the combined own-plus-halo set exceeds the cap, reusing the generated quad data already available before binary encoding. The existing per-edge and corner budgeting remains bounded, but every protected slot is filled from candidates that can affect the relevant visible boundary samples before arbitrary deterministic fallback ordering is used.

- Alternative: apply geometry ranking to every payload. Rejected because it adds cost without correcting uncapped payloads, which already carry all relevant records.

### Decision 3: Treat deterministic selection changes as cache semantics

The persistent cache version changes with the corrected cap policy. Both persistent generator cache keys and `VoxelMeshService` source signatures already include the cache version, so this invalidates stale payloads without changing the `/api/voxels` binary layout or route contract.

### Decision 4: Test the actual worker output at matched seam vertices

Extend `validate:voxel-seams` with a dense capped fixture that creates matching boundary vertices and spatially concentrated sources on both sides. The test decodes generated payloads through the production browser worker in a controlled worker-global shim, then compares normalized emissive attributes for matching position-and-normal keys. It asserts that cap selection retains the records needed to keep the delta within a small encoding tolerance.

The existing membership and light-proxy checks remain useful but cannot detect asymmetric payload membership that still leaves each side with at least one halo emitter.

### Decision 5: Compose coarse halos from same-LOD summary neighbors

LOD `2` through `32` requests load the deterministic 3x3 same-LOD summary neighborhood and retain only representatives whose computed world-space radius intersects the requested horizontal footprint. The maximum input is nine bounded 256-cluster nodes, so composition remains below the existing 8,192-record payload cap without rescanning raw LOD1 sources. Neighbor-owned records use the existing halo flag, keeping them available to the worker bake while excluding them from duplicate runtime accents.

The composed signature hashes the ordered nine-node signatures plus a strategy version. Coarse live invalidation expands by the maximum 28-block summary radius, and voxel cache version 57 prevents reuse of payloads generated with owning-summary-only semantics.

## Risks / Trade-offs

- Geometry-aware ranking can add server work under cap pressure -> Restrict it to capped LOD1 generations and use bounded edge-local sample/index structures.
- Extremely dense boundary geometry can create too many samples -> Deduplicate samples into emitter-radius cells and retain deterministic bounded representatives per cell.
- Equal-distance sources can still compete -> Use stable edge, sample-cell, distance, source-coordinate, and original-index tie-breaking.
- A payload behavior change can leave stale disk entries -> Increment the voxel generator cache version and verify cold and warm payload equivalence after regeneration.
- Worker-harness drift can invalidate the regression test -> Import and execute the production worker module rather than duplicating bake equations.

## Implementation Evidence

- The production-worker adjacent fixture runs below and at the 8,192-record cap. Both runs match nine opaque seam vertices by world position and normal, retain both required same-edge-distance Y/Z-local sources in each payload, and report maximum normalized emissive delta `0.000000`.
- The `SEASON3` nighttime reproduction at LOD1 `640/5376` and `768/5376` loaded both payloads initially and settled with 51 LOD1 tiles. The west payload contains 92 own and 8,100 halo records; the east payload contains 52 own and 8,140 halo records.
- At `(768, 5424, 37)`, both payloads contain the same seven sources inside the 12-block radius: `(762.5,5418.5,43.5)`, `(764.5,5418.5,39.5)`, `(768.5,5422.5,38.5)`, `(770.5,5422.5,38.5)`, `(771.5,5423.5,38.5)`, `(774.5,5429.5,38.5)`, and `(778.5,5422.5,38.5)`. Sources switch own/halo ownership across the seam as expected.
- The worker-baked top-normal values at that vertex are west `(0.152941, 0.349020, 0.082353)` and east `(0.345098, 0.333333, 0.274510)`. Their channel hues differ with the receiving material, while their maximum emitted-light magnitudes differ by `0.003922`, one `Uint8` encoding step.
- The reported LOD2 nighttime view at `(763,5426,51)` crosses the X=768 boundary between payloads `2/512/5376` and `2/768/5376`. After coarse-summary halo composition, the hard dark/bright cutoff is absent. The synthetic production-worker LOD2 fixture matches 129 seam vertices with two cross-boundary representatives and maximum normalized emissive delta `0.000000`.
