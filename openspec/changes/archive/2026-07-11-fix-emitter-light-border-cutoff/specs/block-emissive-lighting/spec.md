## MODIFIED Requirements

### Requirement: Viewer renders bounded block-emissive lighting
The viewer SHALL render block-emissive lighting as a bounded Cubyz-like local illumination approximation where emitted blocks affect nearby voxel surfaces through baked or mesh-local light contribution. The mesh-local emitter bake SHALL deliver light continuously across emitter-grid cell boundaries and across voxel-region boundaries within the configured emitted-light radius, so a receiving surface finds every emitter whose radius reaches it, including neighbor halo emitters owned by adjacent regions, with no cutoff aligned to the emitter grid or region seams. Emitter-grid cell insertion coverage SHALL be at least as large as the falloff reach used for the same emitter, so an emitter that can contribute to a vertex is always discoverable from that vertex's grid-cell lookup. Coarse representative power and influence footprint SHALL be applied monotonically and with configured caps so stronger or wider source clusters remain more visible than weaker clusters without causing unbounded additive blowout. Dynamic point lights and glow sprites SHALL remain optional accents rather than the primary lighting model. Debug-only voxel-lighting performance diagnostics MAY disable halo emitter contribution or mesh-local emissive attributes for measurement, but those diagnostics MUST NOT change the default emitted-light presentation.

#### Scenario: Nighttime scene contains LOD 1 emitting blocks
- **WHEN** the active atmosphere is in a low-light state and loaded LOD 1 regions contain emitter records
- **THEN** emitting blocks preserve their existing self-lit appearance and nearby voxel surfaces receive the existing bounded local emitted-light contribution

#### Scenario: Emitter illuminates surfaces across a grid-cell boundary
- **WHEN** a receiving surface vertex lies in a different emitter-grid cell than an emitter but within that emitter's configured radius
- **THEN** the bake includes that emitter's bounded contribution for the vertex
- **THEN** there is no straight-line brightness cutoff aligned to the emitter-grid cell boundary

#### Scenario: Neighbor halo emitter illuminates surfaces across a region boundary
- **WHEN** a region payload includes a neighbor halo emitter whose radius reaches visible surfaces near the region seam
- **THEN** those surfaces receive the halo emitter's bounded contribution
- **THEN** the light spreads continuously across the region boundary rather than terminating at the seam

#### Scenario: Coarse representative has aggregated power and footprint
- **WHEN** a coarse emitter representative describes multiple LOD 1 sources
- **THEN** the worker uses its bounded power and world-space footprint when baking nearby opaque voxel surfaces
- **THEN** the representative is not treated identically to one ordinary fixed-radius LOD 1 source

#### Scenario: Multiple representatives illuminate nearby surfaces
- **WHEN** nearby coarse or detailed emitters contribute to the same visible voxel surface
- **THEN** the viewer combines their bounded local-light contributions without requiring an unbounded number of Three.js point lights

#### Scenario: Representative power exceeds display range
- **WHEN** a dense source cluster encodes more power than can be displayed without washout
- **THEN** the client applies the configured monotonic compression and contribution clamps while preserving the representative hue

#### Scenario: Representative footprint exceeds bake budget
- **WHEN** a source cluster's measured spatial extent would create an excessive emissive-bake search area
- **THEN** the server or client caps the effective footprint according to the configured coarse-light budget and reports the bounded result through diagnostics

#### Scenario: Loaded emitters exceed rendering budget
- **WHEN** the number of loaded emitter records exceeds the active block-light rendering budget
- **THEN** the viewer preserves bounded local surface illumination for loaded voxel geometry and limits only optional runtime accents to preserve scene responsiveness

#### Scenario: Block-emissive lighting is disabled or unavailable
- **WHEN** block-emissive lighting is disabled by quality settings or unsupported by the decoded payload
- **THEN** voxel rendering continues using existing atmosphere, vertex colors, AO, and scene lighting without failing

#### Scenario: Performance diagnostic disables mesh-local inputs
- **WHEN** debug-only voxel-lighting performance diagnostics disable halo emitter contribution, mesh-local emissive attributes, or both
- **THEN** voxel rendering continues without failing and the default block-emissive lighting behavior is restored when the diagnostic setting is cleared
