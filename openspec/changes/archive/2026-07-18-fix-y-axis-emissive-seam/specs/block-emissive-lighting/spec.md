## MODIFIED Requirements

### Requirement: Mesh-local emitted light is continuous across payload borders
The viewer SHALL bake mesh-local emitted light from payload-owned own-region and halo emitter records so adjacent loaded voxel regions do not show hard emitted-light discontinuities solely because an emitter is owned by one side of a region boundary. Candidate discovery SHALL include every eligible in-radius emitter in the configured grid neighborhood independently of unrelated own-region or halo records and independently of which horizontal side owns the emitter.

#### Scenario: Adjacent regions contain nearby emitters
- **WHEN** adjacent loaded voxel regions contain emitters whose light radii overlap visible surfaces across their shared boundary
- **THEN** the rendered mesh-local emitted-light contribution remains visually continuous across the boundary apart from normal geometry, material, and occlusion differences

#### Scenario: Asymmetric Y-axis region populations share in-radius emitters
- **WHEN** adjacent LOD 1 regions meet across a Y-axis boundary, equivalent own and halo emitters can reach matching visible receiving vertices, and one region contains additional unrelated emitters
- **THEN** the worker evaluates the same eligible in-radius emitter set for the matching vertices on both sides
- **THEN** their normalized baked emissive values differ by no more than one compact-attribute encoding step apart from normal geometry, material, and occlusion differences
