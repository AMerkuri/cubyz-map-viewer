## MODIFIED Requirements

### Requirement: Server maintains bounded LOD 1 emitter summaries for coarse aggregation
The server SHALL derive coarser LOD emitter representatives from a deterministic hierarchy of bounded summaries whose leaf data consists only of visibility-qualified LOD 1 emitted-light sources. A source is visibility-qualified only when the LOD 1 voxel payload represents geometry for that source. Summary nodes SHALL retain enough combined color power, weighted position, and spatial extent to construct coarse representatives without reparsing every covered LOD 1 region for every voxel request.

#### Scenario: Coarse region contains represented LOD 1 emitters
- **WHEN** the server generates a voxel payload at LOD greater than 1 for an area containing visibility-qualified LOD 1 emitted-light sources whose source geometry is represented at the requested LOD
- **THEN** it obtains deterministic bounded source summaries covering that area and derives coarse representatives from those summaries

#### Scenario: Qualified source model is simplified at coarse LOD
- **WHEN** a visibility-qualified LOD 1 emitted-light source model is replaced by air at a coarser requested LOD but its qualified representative can reach generated opaque receiving geometry
- **THEN** the server retains its bounded coarse illumination representative
- **THEN** the server omits the representative when no generated coarse receiving geometry is within its influence footprint

#### Scenario: Coarse request covers many LOD 1 regions
- **WHEN** a coarse voxel region spans more LOD 1 source regions than may be parsed within one generation budget
- **THEN** the server reuses cached child summaries or persisted summary nodes instead of independently reparsing every raw LOD 1 region on each request

#### Scenario: LOD 1 emitter source changes
- **WHEN** a world update changes an LOD 1 emitted-light source, its represented geometry, or its traversable exposure
- **THEN** affected leaf summaries, ancestor summaries, and dependent coarse voxel payloads are invalidated before stale light representatives are served

#### Scenario: Summary exceeds representative budget
- **WHEN** a summary node contains more source clusters than its configured budget allows
- **THEN** it deterministically retains or combines the strongest and most spatially significant visibility-qualified clusters while keeping summary size bounded

### Requirement: Voxel payload includes compact emitter records
The `/api/voxels` binary payload SHALL include compact LOD 1 block-light emitter records only for source blocks whose geometry is represented in that payload. For voxel LODs greater than 1, the payload SHALL include bounded emitter representatives derived from visibility-qualified LOD 1 source summaries only when their influence reaches generated opaque geometry at the requested LOD. Coarser LOD records SHALL carry or deterministically imply representative power and world-space influence footprint in addition to position, color, exposure, and ownership semantics so aggregation does not reduce every cluster to one ordinary fixed-radius source.

#### Scenario: LOD 1 region contains a represented emitting block
- **WHEN** the server generates a LOD 1 voxel mesh for a region and a block with non-zero emitted light contributes represented geometry
- **THEN** the encoded payload includes a detailed emitter record with region-local block coordinates and emitted RGB color for that block
- **THEN** its default power and influence footprint preserve the existing LOD 1 appearance

#### Scenario: LOD 1 emitting block has no represented geometry
- **WHEN** a block has non-zero emitted-light metadata but all of its faces or model geometry are suppressed from the generated LOD 1 mesh
- **THEN** the encoded payload MUST NOT include an own-region emitter record for that block

#### Scenario: Coarser LOD region contains represented LOD 1 sources
- **WHEN** the server generates a voxel mesh at LOD greater than 1 whose covered area contains strong or clustered visibility-qualified LOD 1 emitted-light sources with represented source geometry at the requested LOD
- **THEN** the encoded payload includes bounded representatives whose combined color power, weighted position, and influence footprint approximate those source clusters

#### Scenario: Coarser LOD source model is absent from same-LOD chunks
- **WHEN** a visibility-qualified LOD 1 source model is discarded by corresponding coarser voxel data
- **THEN** the coarse payload MAY retain its bounded representative only when it reaches represented coarse receiving geometry

#### Scenario: Coarser LOD emitter records are decoded by the client
- **WHEN** the client worker decodes a coarser LOD voxel payload containing qualified representative power and footprint semantics
- **THEN** it applies those semantics through the bounded emissive bake path and exposes the representatives for runtime accents

#### Scenario: Coarser LOD region contains only weak or sparse sources
- **WHEN** LOD 1 source summaries contain only emitters below the configured coarse-representation threshold
- **THEN** the encoded payload MAY omit those emitters to preserve payload and runtime budgets

#### Scenario: Region has no represented emitting blocks
- **WHEN** the covered LOD 1 source summaries contain no visibility-qualified non-zero emitted-light blocks
- **THEN** the encoded payload represents an empty emitter set without requiring a separate request

### Requirement: Voxel payload includes emitted-light halo records
The `/api/voxels` binary payload SHALL include enough visibility-qualified emitted-light records for a region to bake mesh-local light from neighboring emitters within the configured light radius when they can affect generated visible opaque geometry in the requested region. Halo collection SHALL limit candidates to the bounded visible vertical envelope of the requested geometry and SHALL retain the existing binary halo ownership semantics.

#### Scenario: Neighbor emitter is within halo radius
- **WHEN** the server generates a voxel payload for a region and a visibility-qualified neighboring-region emitter is within the emitted-light radius of generated visible geometry in the requested region
- **THEN** the encoded payload includes that emitter as halo data for mesh-local light baking

#### Scenario: Neighbor emitter is outside visible relevance
- **WHEN** a neighboring emitted-light block is outside the requested payload's visible vertical envelope, lacks represented source geometry, or cannot affect generated visible geometry under the configured emitted-light radius
- **THEN** the server MUST NOT include that block as halo data

#### Scenario: Emitter payload format changes for halo support
- **WHEN** halo support requires signed relative coordinates, absolute coordinates, or any other binary emitter layout change
- **THEN** voxel payload decoding and persistent voxel mesh cache validity MUST distinguish the new format from older payloads

### Requirement: Emitter metadata participates in voxel cache validity
Voxel mesh cache keys and emitter-summary cache keys SHALL distinguish emitted-light metadata, source-geometry eligibility, halo-selection behavior, emitter payload format, coarse source-summary behavior, aggregation behavior, and emitted-light rendering semantics so stale geometry-only, stale-color, stale-format, stale-source, stale-aggregation, or stale-local-light payloads are not reused after emitter-relevant changes.

#### Scenario: Emitted-light metadata changes
- **WHEN** layered block assets change the `.emittedLight` value for a palette entry
- **THEN** generated voxel payloads and derived emitter summaries reflect the current emitted-light color rather than stale cached values

#### Scenario: Source-eligibility behavior changes
- **WHEN** the server changes represented-source eligibility, visible vertical-envelope selection, or halo geometry relevance
- **THEN** previously persisted voxel mesh entries and source summaries generated with the old behavior are not reused

#### Scenario: Emitter payload format changes
- **WHEN** the binary emitter record layout or interpretation changes
- **THEN** previously persisted voxel mesh cache entries generated with the old layout are not reused

#### Scenario: Coarser LOD aggregation behavior changes
- **WHEN** source-summary thresholds, grouping, source-geometry eligibility, power encoding, footprint encoding, or representative behavior changes for LODs greater than 1
- **THEN** persisted source summaries and coarse voxel mesh cache entries generated with the old behavior are not reused

#### Scenario: LOD 1 source dependency changes
- **WHEN** an LOD 1 region contributing to one or more coarse summaries changes
- **THEN** affected summary ancestors and dependent coarse voxel mesh cache entries are invalidated

#### Scenario: Local-light rendering semantics change
- **WHEN** server-generated or client-decoded voxel payload semantics change for representative power or influence footprint
- **THEN** previously persisted voxel mesh cache entries generated with the old lighting semantics are not reused

### Requirement: Viewer renders bounded block-emissive lighting
The viewer SHALL render block-emissive lighting as a bounded Cubyz-like local illumination approximation where only visibility-qualified emitted blocks affect nearby voxel surfaces through baked or mesh-local light contribution. The mesh-local emitter bake SHALL deliver light continuously across emitter-grid cell boundaries and across voxel-region boundaries within the configured emitted-light radius, so a receiving surface finds every eligible emitter whose radius reaches it, including neighbor halo emitters owned by adjacent regions, with no cutoff aligned to the emitter grid or region seams. Emitter-grid cell insertion coverage SHALL be at least as large as the falloff reach used for the same emitter, so an emitter that can contribute to a vertex is always discoverable from that vertex's grid-cell lookup. Coarse representative power and influence footprint SHALL be applied monotonically and with configured caps so stronger or wider source clusters remain more visible than weaker clusters without causing unbounded additive blowout. Dynamic point lights and glow sprites SHALL remain optional accents rather than the primary lighting model. Debug-only voxel-lighting performance diagnostics MAY disable halo emitter contribution or mesh-local emissive attributes for measurement, but those diagnostics MUST NOT change the default emitted-light presentation.

#### Scenario: Nighttime scene contains a represented LOD 1 emitting block
- **WHEN** the active atmosphere is in a low-light state and loaded LOD 1 regions contain visibility-qualified emitter records
- **THEN** emitting blocks preserve their existing self-lit appearance and nearby voxel surfaces receive the existing bounded local emitted-light contribution

#### Scenario: Source geometry is absent
- **WHEN** a payload contains no represented geometry for an emitted-light source at its active LOD
- **THEN** the viewer MUST NOT render mesh-local illumination, a glow sprite, or a point-light accent attributable to that source

#### Scenario: Emitter illuminates surfaces across a grid-cell boundary
- **WHEN** a receiving surface vertex lies in a different emitter-grid cell than an eligible emitter but within that emitter's configured radius
- **THEN** the bake includes that emitter's bounded contribution for the vertex
- **THEN** there is no straight-line brightness cutoff aligned to the emitter-grid cell boundary

#### Scenario: Neighbor halo emitter illuminates surfaces across a region boundary
- **WHEN** a region payload includes an eligible neighbor halo emitter whose radius reaches visible surfaces near the region seam
- **THEN** those surfaces receive the halo emitter's bounded contribution
- **THEN** the light spreads continuously across the region boundary rather than terminating at the seam

#### Scenario: Coarse representative has aggregated power and footprint
- **WHEN** a coarse emitter representative describes multiple eligible LOD 1 sources and represented source geometry at the requested LOD
- **THEN** the worker uses its bounded power and world-space footprint when baking nearby opaque voxel surfaces
- **THEN** the representative is not treated identically to one ordinary fixed-radius LOD 1 source

#### Scenario: Multiple representatives illuminate nearby surfaces
- **WHEN** nearby coarse or detailed eligible emitters contribute to the same visible voxel surface
- **THEN** the viewer combines their bounded local-light contributions without requiring an unbounded number of Three.js point lights

#### Scenario: Representative power exceeds display range
- **WHEN** a dense source cluster encodes more power than can be displayed without washout
- **THEN** the client applies the configured monotonic compression and contribution clamps while preserving the representative hue

#### Scenario: Representative footprint exceeds bake budget
- **WHEN** a source cluster's measured spatial extent would create an excessive emissive-bake search area
- **THEN** the server or client caps the effective footprint according to the configured coarse-light budget and reports the bounded result through diagnostics

#### Scenario: Loaded emitters exceed rendering budget
- **WHEN** the number of loaded eligible emitter records exceeds the active block-light rendering budget
- **THEN** the viewer preserves bounded local surface illumination for loaded voxel geometry and limits only optional runtime accents to preserve scene responsiveness

#### Scenario: Block-emissive lighting is disabled or unavailable
- **WHEN** block-emissive lighting is disabled by quality settings or unsupported by the decoded payload
- **THEN** voxel rendering continues using existing atmosphere, vertex colors, AO, and scene lighting without failing

#### Scenario: Performance diagnostic disables mesh-local inputs
- **WHEN** debug-only voxel-lighting performance diagnostics disable halo emitter contribution, mesh-local emissive attributes, or both
- **THEN** voxel rendering continues without failing and the default block-emissive lighting behavior is restored when the diagnostic setting is cleared
