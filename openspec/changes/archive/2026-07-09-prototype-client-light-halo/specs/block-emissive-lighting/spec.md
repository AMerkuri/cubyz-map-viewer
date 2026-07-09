## ADDED Requirements

### Requirement: Client prototype blends loaded neighbor emitter halos
The client SHALL be able to prototype mesh-local emitted-light baking with emitter records from nearby loaded voxel regions when those emitters fall within the configured emitted-light radius of the region being built.

#### Scenario: Neighbor emitter affects border surface
- **WHEN** two adjacent LOD 1 voxel regions are loaded and an emitter in one region is within emitted-light radius of visible opaque surfaces in the other region
- **THEN** the client prototype includes that emitter in the affected region's mesh-local light contribution so the light does not stop at the region border

#### Scenario: Neighbor region is not loaded
- **WHEN** a region is built before an adjacent emitter-owning region is loaded
- **THEN** the client MUST render the region with available same-region emitter data and MUST NOT fail because neighbor halo data is unavailable

#### Scenario: Neighbor halo arrives later
- **WHEN** a newly loaded neighboring region contains emitters that can affect an already loaded region
- **THEN** the client SHALL refresh or rebuild the affected region's mesh-local light contribution without requiring a server payload format change
