## ADDED Requirements

### Requirement: Transparent voxel separation remains memory-bounded
The client SHALL render transparent voxel faces separately from opaque voxel faces without retaining avoidable duplicate geometry or metadata arrays for loaded and warm-cached voxel tiles.

#### Scenario: Region contains opaque and transparent quads
- **WHEN** the client worker decodes a voxel payload containing both opaque and transparent quads
- **THEN** the client MUST build renderable opaque and transparent meshes that preserve view-through behavior
- **THEN** retained CPU-side metadata for those meshes MUST be limited to data required for AO updates, hover identity, refresh, and rendering correctness

#### Scenario: Debug HUD reports transparent voxel memory
- **WHEN** loaded or warm-cached voxel tiles include transparent submeshes
- **THEN** the debug HUD memory estimate MUST include transparent geometry and metadata in the voxel total
- **THEN** the estimate MUST NOT double-count the same typed-array bytes as both geometry attributes and retained metadata

### Requirement: Transparent voxel metrics identify payload cost
Voxel diagnostics SHALL make transparent geometry cost visible separately from total voxel geometry cost.

#### Scenario: Transparent-heavy region is loaded
- **WHEN** the viewer loads a voxel region containing transparent renderable blocks
- **THEN** debug or service metrics MUST expose enough information to identify transparent quad count or transparent mesh memory contribution separately from opaque geometry
