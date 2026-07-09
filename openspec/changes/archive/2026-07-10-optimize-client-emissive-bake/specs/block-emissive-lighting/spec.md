## ADDED Requirements

### Requirement: Mesh-local emitted light preserves default visual semantics
The viewer SHALL preserve the default mesh-local emitted-light appearance and runtime block-light controls while optimizing client worker bake cost and emissive attribute representation.

#### Scenario: Block-light quality is enabled
- **WHEN** voxel geometry contains baked emissive attributes and block-light quality is enabled
- **THEN** the voxel material applies mesh-local emitted light through the existing shader strength control

#### Scenario: Block-light quality is disabled
- **WHEN** block-light quality or atmosphere block-light presentation disables mesh-local emitted light
- **THEN** optimized emissive attributes remain gated by the existing shared shader strength control

### Requirement: Runtime emitter accents remain independent of mesh-local bake optimization
The viewer SHALL continue to decode emitter records for runtime glow sprites, point-light accents, lifecycle stats, and diagnostics regardless of emissive attribute optimization.

#### Scenario: Emissive attribute baking is optimized or disabled diagnostically
- **WHEN** a voxel payload contains emitter records
- **THEN** runtime emitter records remain available for decoded-emitter stats and accent management according to existing quality budgets

### Requirement: Optimized emissive attributes do not require server payload changes
The client SHALL consume the existing `/api/voxels` binary payload format for emitted-light records while optimizing only client-side bake and upload representation.

#### Scenario: Server returns existing voxel binary payload
- **WHEN** the client worker receives the current voxel binary payload with emitter records
- **THEN** it can produce optimized emissive output without requiring a server payload format migration
