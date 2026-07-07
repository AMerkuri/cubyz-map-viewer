## ADDED Requirements

### Requirement: Optimized voxel payload preserves transparent separation
The optimized voxel payload and worker decode path SHALL preserve enough render-kind information to build transparent voxel faces separately from opaque voxel faces for both parametric greedy records and fractional model records.

#### Scenario: Parametric greedy transparent quad is decoded
- **WHEN** the client worker decodes a parametric greedy record whose render kind is transparent
- **THEN** the decoded triangles MUST be emitted into transparent mesh output arrays rather than opaque mesh output arrays
- **THEN** the decoded geometry MUST preserve the same world-space face boundary as the server-generated greedy quad

#### Scenario: Mixed opaque and transparent payload is decoded
- **WHEN** a voxel payload contains opaque greedy records, transparent greedy records, and fractional model records
- **THEN** the client MUST build separate opaque and transparent renderable meshes without losing color, winding, normal, AO, position, or palette identity data needed for rendering correctness

### Requirement: Transparent payload cost remains measurable
Voxel diagnostics SHALL expose transparent geometry cost after the optimized payload format is introduced.

#### Scenario: Transparent-heavy region is loaded
- **WHEN** the viewer loads or benchmarks a voxel region containing transparent renderable quads
- **THEN** debug or service metrics MUST expose transparent quad count or transparent output contribution separately from total voxel geometry cost
