## Context

Client-side same-region mesh-light baking creates visible light seams at voxel region borders. A client prototype can tune the halo behavior, but stable production behavior should not depend on neighbor load order. The server already owns voxel payload generation and cache validity, making it the right place to provide deterministic emitter data for each region.

## Goals / Non-Goals

**Goals:**

- Include light-radius emitter halo data in voxel payloads so each region can bake seamless border lighting independently.
- Support emitters outside the region-local unsigned coordinate range if needed.
- Keep runtime accents secondary to mesh-local illumination.
- Update cache signatures and docs for any binary payload contract change.

**Non-Goals:**

- Add a separate `/api/lights` endpoint.
- Implement exact occlusion-aware light propagation.
- Solve coarser LOD aggregation beyond preserving any existing LOD behavior unless this change explicitly needs shared helpers.

## Decisions

### Decision: Make halo emitters part of the voxel payload contract

Each generated voxel region should include emitter records that can influence surfaces inside that region, including own-region emitters and neighboring emitters within the configured light radius. This makes the baked result deterministic for a given payload.

Alternatives considered:

- Client neighbor rebake. Useful as a prototype but less stable because lighting depends on load order and rebuild timing.
- Runtime point lights. Rejected because the primary light model should remain mesh-local and bounded.

### Decision: Prefer an explicit coordinate format over unsigned local hacks

If halo emitters can lie outside region-local `[0, regionSize)` coordinates, the binary format should represent them clearly, either as signed relative coordinates or absolute world coordinates. The chosen format should be versioned and documented.

Alternatives considered:

- Clamp halo emitters to the region edge. Rejected because it distorts falloff and can create border artifacts.
- Encode only same-region emitters plus an implicit neighbor lookup. Rejected because the payload would no longer be self-contained.

### Decision: Invalidate persisted voxel payloads on format or interpretation change

Emitter halo records change what the client can bake from a payload. If binary layout or emitter interpretation changes, the voxel cache signature must distinguish old and new payloads.

## Risks / Trade-offs

- Payload size increases near emitter-dense borders -> Cap halo records and consider stronger-source prioritization if needed.
- Neighbor file reads can increase generation cost -> Restrict scans to light-radius border bands and reuse existing chunk loading where possible.
- Cache invalidation becomes broader near light changes -> Document that border-near emitter changes can affect adjacent region payloads.
- Coordinate format changes can break old decoders -> Version the binary magic/layout and keep decoding behavior explicit.
