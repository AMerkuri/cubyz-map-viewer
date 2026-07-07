## ADDED Requirements

### Requirement: Hover identity survives voxel payload optimization
Voxel payload and client retention optimizations SHALL preserve the ability to resolve the saved Cubyz block ID for rendered opaque, transparent, and model-backed voxel faces under the cursor.

#### Scenario: Hovering optimized cube geometry
- **WHEN** the pointer hovers over a rendered voxel face decoded from an optimized compact cube representation
- **THEN** the cursor hover information MUST include the corresponding saved Cubyz block ID when the palette mapping is available

#### Scenario: Hovering optimized model or transparent geometry
- **WHEN** the pointer hovers over a rendered model-backed or transparent voxel face after payload or metadata retention optimization
- **THEN** the cursor hover information MUST include the corresponding saved Cubyz block ID when the palette mapping is available

#### Scenario: Hover metadata is reduced
- **WHEN** implementation reduces retained per-triangle or per-vertex metadata for voxel meshes
- **THEN** the remaining metadata MUST still map cursor intersections to the correct save block palette index or intentionally omit identity only when no resolvable palette mapping exists
