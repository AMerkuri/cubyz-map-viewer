## ADDED Requirements

### Requirement: Voxel payload includes emitted-light halo records
The `/api/voxels` binary payload SHALL include enough emitted-light records for a region to bake mesh-local light from emitters within the configured light radius, including emitters owned by neighboring voxel regions when they can affect visible surfaces in the requested region.

#### Scenario: Neighbor emitter is within halo radius
- **WHEN** the server generates a voxel payload for a region and a neighboring-region emitter is within the emitted-light radius of the requested region's visible geometry
- **THEN** the encoded payload includes that emitter as halo data for mesh-local light baking

#### Scenario: Neighbor emitter is outside halo radius
- **WHEN** the server generates a voxel payload and a neighboring-region emitter cannot affect any visible geometry in the requested region under the configured emitted-light radius
- **THEN** the encoded payload MAY omit that emitter from the requested region's halo data

#### Scenario: Emitter payload format changes for halo support
- **WHEN** halo support requires signed relative coordinates, absolute coordinates, or any other binary emitter layout change
- **THEN** voxel payload decoding and persistent voxel mesh cache validity MUST distinguish the new format from older payloads

### Requirement: Mesh-local emitted light is continuous across payload borders
The viewer SHALL bake mesh-local emitted light from payload-owned own-region and halo emitter records so adjacent loaded voxel regions do not show hard emitted-light discontinuities solely because an emitter is owned by one side of a region boundary.

#### Scenario: Adjacent regions contain nearby emitters
- **WHEN** adjacent loaded voxel regions contain emitters whose light radii overlap visible surfaces across their shared boundary
- **THEN** the rendered mesh-local emitted-light contribution remains visually continuous across the boundary apart from normal geometry, material, and occlusion differences
