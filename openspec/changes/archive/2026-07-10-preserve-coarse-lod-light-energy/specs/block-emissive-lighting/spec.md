## ADDED Requirements

### Requirement: Server maintains bounded LOD 1 emitter summaries for coarse aggregation
The server SHALL derive coarser LOD emitter representatives from a deterministic hierarchy of bounded summaries whose leaf data comes from LOD 1 emitted-light sources. Summary nodes SHALL retain enough combined color power, weighted position, and spatial extent to construct coarse representatives without reparsing every covered LOD 1 region for every voxel request.

#### Scenario: Coarse region contains LOD 1 emitters
- **WHEN** the server generates a voxel payload at LOD greater than 1 for an area containing LOD 1 emitted-light sources
- **THEN** it obtains deterministic bounded source summaries covering that area and derives coarse representatives from those summaries

#### Scenario: Coarse request covers many LOD 1 regions
- **WHEN** a coarse voxel region spans more LOD 1 source regions than may be parsed within one generation budget
- **THEN** the server reuses cached child summaries or persisted summary nodes instead of independently reparsing every raw LOD 1 region on each request

#### Scenario: LOD 1 emitter source changes
- **WHEN** a world update changes an LOD 1 emitted-light source or its traversable exposure
- **THEN** affected leaf summaries, ancestor summaries, and dependent coarse voxel payloads are invalidated before stale light representatives are served

#### Scenario: Summary exceeds representative budget
- **WHEN** a summary node contains more source clusters than its configured budget allows
- **THEN** it deterministically retains or combines the strongest and most spatially significant clusters while keeping summary size bounded

## MODIFIED Requirements

### Requirement: Voxel payload includes compact emitter records
The `/api/voxels` binary payload SHALL include compact block-light emitter records for LOD 1 regions, derived from block values whose palette index has non-zero emitted-light metadata. For voxel LODs greater than 1, the payload SHALL include bounded emitter representatives derived from LOD 1 source summaries when important emitted-light sources occur in the covered area. Coarser LOD records SHALL carry or deterministically imply representative power and world-space influence footprint in addition to position, color, exposure, and ownership semantics so aggregation does not reduce every cluster to one ordinary fixed-radius source.

#### Scenario: LOD 1 region contains emitting blocks
- **WHEN** the server generates a LOD 1 voxel mesh for a region containing blocks with non-zero emitted light
- **THEN** the encoded payload includes detailed emitter records with region-local block coordinates and emitted RGB color for those blocks
- **THEN** their default power and influence footprint preserve the existing LOD 1 appearance

#### Scenario: Coarser LOD region contains important LOD 1 sources
- **WHEN** the server generates a voxel mesh at LOD greater than 1 whose covered area contains strong or clustered LOD 1 emitted-light sources
- **THEN** the encoded payload includes bounded representatives whose combined color power, weighted position, and influence footprint approximate those source clusters

#### Scenario: Coarser LOD source is absent from same-LOD chunks
- **WHEN** an important emitted-light source exists in LOD 1 source data but was discarded by the corresponding coarser voxel data
- **THEN** the coarse emitter summary remains eligible to represent that source

#### Scenario: Coarser LOD emitter records are decoded by the client
- **WHEN** the client worker decodes a coarser LOD voxel payload containing representative power and footprint semantics
- **THEN** it applies those semantics through the bounded emissive bake path and exposes the representatives for runtime accents

#### Scenario: Coarser LOD region contains only weak or sparse sources
- **WHEN** LOD 1 source summaries contain only emitters below the configured coarse-representation threshold
- **THEN** the encoded payload MAY omit those emitters to preserve payload and runtime budgets

#### Scenario: Region has no emitting blocks
- **WHEN** the covered LOD 1 source summaries contain no non-zero emitted-light blocks
- **THEN** the encoded payload represents an empty emitter set without requiring a separate request

### Requirement: Emitter metadata participates in voxel cache validity
Voxel mesh cache keys and emitter-summary cache keys SHALL distinguish emitted-light metadata, emitter payload format, coarse source-summary behavior, aggregation behavior, and emitted-light rendering semantics so stale geometry-only, stale-color, stale-format, stale-source, stale-aggregation, or stale-local-light payloads are not reused after emitter-relevant changes.

#### Scenario: Emitted-light metadata changes
- **WHEN** layered block assets change the `.emittedLight` value for a palette entry
- **THEN** generated voxel payloads and derived emitter summaries reflect the current emitted-light color rather than stale cached values

#### Scenario: Emitter payload format changes
- **WHEN** the binary emitter record layout or interpretation changes
- **THEN** previously persisted voxel mesh cache entries generated with the old layout are not reused

#### Scenario: Coarser LOD aggregation behavior changes
- **WHEN** source-summary thresholds, grouping, power encoding, footprint encoding, or representative behavior changes for LODs greater than 1
- **THEN** persisted source summaries and coarse voxel mesh cache entries generated with the old behavior are not reused

#### Scenario: LOD 1 source dependency changes
- **WHEN** an LOD 1 region contributing to one or more coarse summaries changes
- **THEN** affected summary ancestors and dependent coarse voxel mesh cache entries are invalidated

#### Scenario: Local-light rendering semantics change
- **WHEN** server-generated or client-decoded voxel payload semantics change for representative power or influence footprint
- **THEN** previously persisted voxel mesh cache entries generated with the old lighting semantics are not reused

### Requirement: Viewer renders bounded block-emissive lighting
The viewer SHALL render block-emissive lighting as a bounded Cubyz-like local illumination approximation where emitted blocks affect nearby voxel surfaces through baked or mesh-local light contribution. Coarse representative power and influence footprint SHALL be applied monotonically and with configured caps so stronger or wider source clusters remain more visible than weaker clusters without causing unbounded additive blowout. Dynamic point lights and glow sprites SHALL remain optional accents rather than the primary lighting model. Debug-only voxel-lighting performance diagnostics MAY disable halo emitter contribution or mesh-local emissive attributes for measurement, but those diagnostics MUST NOT change the default emitted-light presentation.

#### Scenario: Nighttime scene contains LOD 1 emitting blocks
- **WHEN** the active atmosphere is in a low-light state and loaded LOD 1 regions contain emitter records
- **THEN** emitting blocks preserve their existing self-lit appearance and nearby voxel surfaces receive the existing bounded local emitted-light contribution

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
