## Why

The viewer can now darken the world with client-local time-of-day, but Cubyz blocks that should illuminate night scenes, such as torches, lava, lamps, glow crystals, and luminous plants, do not contribute any visible local light. Cubyz assets already expose authoritative per-block light colors through `.emittedLight`, so the map viewer can use existing game metadata instead of guessing from block IDs or texture names.

## What Changes

- Parse layered Cubyz block definitions for `.emittedLight` and expose palette-indexed block-emitter metadata to voxel generation.
- Extend voxel region output so LOD 1 regions can include compact light-emitter records alongside existing mesh geometry.
- Decode light-emitter records on the client and reconcile their lifecycle with loaded voxel regions.
- Render nighttime block illumination with a bounded, map-friendly approximation: visible emissive blocks remain readable and nearby emitters can add local glow without requiring full Cubyz light propagation parity.
- Add graphics/debug controls or quality gating so emitter effects can be reduced or disabled on constrained clients.
- Update voxel contract and runtime documentation to describe emitter metadata, payload behavior, and client rendering semantics.

## Capabilities

### New Capabilities
- `block-emissive-lighting`: Defines how Cubyz `.emittedLight` metadata is discovered, encoded, decoded, and rendered as local block lighting in the world viewer.

### Modified Capabilities
- `world-atmosphere`: Low-light atmosphere behavior must account for block-emissive lighting so night scenes can remain navigable without raising global ambient light.

## Impact

- Server asset services: block visual metadata must include `.emittedLight` values from layered block definitions.
- Server voxel pipeline: `VoxelMeshService`, worker protocol, voxel cache signatures, and `/api/voxels` binary payload semantics change to include emitter data.
- Client voxel worker/types/runtime: decoded voxel tiles need emitter metadata, region unload cleanup, and bounded scene rendering for lights/glows.
- Client controls/debug: emitter quality or enablement should be configurable with existing graphics/debug settings patterns.
- Documentation: update `docs/architecture-overview.md`, `docs/client-specification.md`, and `docs/server-specification.md` because this changes the shared voxel payload contract and runtime behavior.
