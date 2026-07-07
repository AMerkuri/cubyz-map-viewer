## ADDED Requirements

### Requirement: Hover identity survives parametric greedy decode
The optimized voxel payload and worker decode path SHALL preserve the ability to resolve the saved Cubyz block ID for rendered faces decoded from parametric greedy records and fractional model records.

#### Scenario: Hovering parametric greedy cube geometry
- **WHEN** the pointer hovers over a rendered voxel face decoded from a parametric greedy cube record
- **THEN** the cursor hover information MUST include the corresponding saved Cubyz block ID when the palette mapping is available

#### Scenario: Hovering fractional model geometry after direct decode
- **WHEN** the pointer hovers over a rendered model-backed voxel face decoded through the optimized worker path
- **THEN** the cursor hover information MUST include the corresponding saved Cubyz block ID when the palette mapping is available

#### Scenario: Hovering transparent optimized geometry
- **WHEN** the pointer hovers over a rendered transparent voxel face decoded from either a parametric greedy record or fractional model record
- **THEN** the cursor hover information MUST include the corresponding saved Cubyz block ID when the palette mapping is available
