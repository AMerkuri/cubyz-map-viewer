## Why

The first mesh-local block lighting implementation bakes emitted light from same-region records only, which creates visible hard cuts at voxel region borders when nearby emitters live in adjacent loaded regions. A client-side prototype lets us tune cross-border light behavior quickly before committing to a server payload contract change.

## What Changes

- Add a temporary client-owned cross-region light halo path for mesh-local emitted-light baking.
- Let a voxel mesh build include nearby emitter records from already-loaded neighboring voxel regions within the emitted-light radius.
- Rebuild or refresh affected client voxel meshes when newly loaded neighbors can materially affect their baked light halo.
- Keep the server voxel payload unchanged for this prototype.
- Use the prototype to tune halo radius, falloff, candidate caps, and visual continuity at region borders.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `block-emissive-lighting`: Mesh-local emitted light must be able to cross visible loaded-region boundaries during the client prototype path instead of stopping at same-region payload boundaries.

## Impact

- Client voxel runtime, worker input protocol, loaded voxel lifecycle, and mesh rebuild/invalidation behavior.
- No server route, binary payload, or persistent cache contract changes are intended for this prototype.
- Documentation should describe the prototype client halo behavior if it remains user-visible after implementation.
