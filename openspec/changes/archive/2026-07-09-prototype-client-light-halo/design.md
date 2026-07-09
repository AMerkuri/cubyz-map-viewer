## Context

Mesh-local emitted light is currently baked inside the browser voxel worker from emitter records decoded from the same voxel region payload. That makes the new surface lighting look good inside a region but produces hard discontinuities at region borders when the influencing light source is owned by a neighboring loaded region.

This change is intentionally a prototype. It should validate visual behavior and tuning quickly without changing the server voxel payload or persistent cache contract.

## Goals / Non-Goals

**Goals:**

- Let loaded neighboring region emitters contribute to mesh-local light near region boundaries.
- Preserve the existing server payload while tuning halo radius, falloff, and candidate caps.
- Keep the prototype bounded and reversible.
- Capture enough visual evidence to decide whether the stable payload-owned halo change should proceed.

**Non-Goals:**

- Change the `/api/voxels` binary format.
- Persist client-baked mesh-light results.
- Solve missing emitters on coarser LODs.
- Implement exact occlusion-aware Cubyz light propagation.

## Decisions

### Decision: Merge loaded neighbor emitters on the client

The client runtime should collect emitter records from nearby loaded voxel regions and pass the relevant subset into the worker when building or rebuilding a region mesh. The worker should continue using absolute world coordinates for light evaluation.

Alternatives considered:

- Server-side halo payloads. Deferred to the follow-up payload-owned change because it is more stable but requires contract/cache work.
- Shader-only dynamic emitter sampling. Rejected for this prototype because it adds GPU uniform/texture complexity before validating the visual model.

### Decision: Rebuild only affected border-near meshes

When a neighboring region loads, only regions within the emitted-light radius of its emitters should be eligible for a halo refresh. The prototype should avoid global voxel rebakes and should reuse existing stale/refresh patterns where practical.

Alternatives considered:

- Rebuild all loaded voxel meshes whenever emitters change. Rejected as too expensive and visually noisy.
- Never rebuild existing meshes. Rejected because it leaves load-order seams until a normal refresh happens.

### Decision: Treat this as a tuning spike

The result should be judged by the known night border scene: the hard line between torch and lava regions should disappear or become non-obvious. The implementation may remain less deterministic than payload-owned halos because load order is part of the prototype trade-off.

## Risks / Trade-offs

- Load-order artifacts can remain until neighboring regions finish loading -> Track this as prototype limitation and compare against payload-owned follow-up.
- Mesh rebuilds can cause visible popping -> Limit rebuilds to radius-affected regions and keep current mesh until replacement is ready.
- Worker input can grow with dense emitters -> Filter by light radius and keep per-vertex candidate caps.
- Prototype code can become permanent accidentally -> Keep docs and task names explicit that this validates behavior before the stable server-owned design.
