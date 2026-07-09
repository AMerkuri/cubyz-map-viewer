## Why

Same-region-only emitted-light baking creates hard seams at voxel region borders, and client-side neighbor merging can be affected by load order. Payload-owned light halos make cross-border mesh lighting deterministic and stable for every region response.

## What Changes

- Extend voxel payload generation so each voxel region can include emitter records from neighboring regions within the emitted-light radius.
- Update the binary emitter record representation if needed to support halo emitters outside the region's local unsigned coordinate range.
- Bake mesh-local emitted light from own-region emitters plus payload halo emitters.
- Version or invalidate voxel payload caches if the wire format or persisted payload interpretation changes.
- Keep runtime point lights and glow sprites as optional accents over the payload-owned mesh-local illumination.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `block-emissive-lighting`: Mesh-local emitted light must include a light-radius halo across region boundaries so surface illumination remains continuous at loaded voxel region seams.

## Impact

- Server voxel generation, binary voxel payload format, voxel cache signatures, client worker decoding, and block-light documentation.
- Shared contract changes require updates to `docs/architecture-overview.md`, `docs/server-specification.md`, and `docs/client-specification.md`.
- Build verification is required because this touches worker boundaries and route payload semantics.
