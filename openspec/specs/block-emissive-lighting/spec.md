## Purpose

Define block-emissive lighting metadata, payload, lifecycle, and viewer rendering behavior for Cubyz voxel regions.

## Requirements

### Requirement: Server builds block emitted-light metadata from Cubyz assets
The server SHALL read numeric `.emittedLight` values from layered Cubyz block definitions and expose palette-indexed emitted-light metadata for voxel generation.

#### Scenario: Block definition declares emitted light
- **WHEN** a palette entry resolves to a block definition containing `.emittedLight = 0xRRGGBB`
- **THEN** the server records that palette entry as a block-light emitter with RGB color decoded from the `0xRRGGBB` value

#### Scenario: Block definition has no emitted light
- **WHEN** a palette entry resolves to a block definition without `.emittedLight`
- **THEN** the server records that palette entry as non-emitting

#### Scenario: Emission texture exists without emitted light metadata
- **WHEN** a block texture has a matching `*_emission.png` but the block definition has no `.emittedLight`
- **THEN** the server MUST NOT classify that block as a light emitter from the texture filename alone

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

### Requirement: Voxel payload includes emitted-light halo records
The `/api/voxels` binary payload SHALL include enough emitted-light records for a region to bake mesh-local light from emitters within the configured light radius, including emitters owned by neighboring voxel regions when they can affect visible surfaces in the requested region.

#### Scenario: Neighbor emitter is within halo radius
- **WHEN** the server generates a voxel payload for a region and a neighboring-region emitter is within the emitted-light radius of the requested region's visible geometry
- **THEN** the encoded payload includes that emitter as halo data for mesh-local light baking

#### Scenario: Neighbor emitter is outside halo radius
- **WHEN** the server generates a voxel payload and a neighboring-region emitter cannot affect any visible geometry in the requested region under the configured emitted-light radius
- **THEN** the encoded payload MAY omit that emitter from the requested region's halo data

#### Scenario: Emitter payload format changes for halo support
- **WHEN** halo support requires signed relative coordinates, absolute coordinates, or any other binary emitter layout change
- **THEN** voxel payload decoding and persistent voxel mesh cache validity MUST distinguish the new format from older payloads

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

### Requirement: Client decodes and owns emitter lifecycle per voxel region
The client voxel worker SHALL decode emitter records from voxel payloads and the world-view runtime SHALL reconcile rendered emitter effects with loaded LOD 1 voxel regions.

#### Scenario: Region with emitters loads
- **WHEN** a LOD 1 voxel region payload with emitter records is decoded and uploaded
- **THEN** the client associates those emitters with the loaded voxel region and makes them available to the block-light rendering runtime

#### Scenario: Region with emitters unloads or refreshes
- **WHEN** a voxel region is unloaded, replaced, or invalidated by world updates
- **THEN** the client removes or replaces the emitter effects owned by that region without leaving stale scene objects

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

### Requirement: Runtime block-light accents preserve emitter color
Runtime block-light glow sprites and point-light accents SHALL remain secondary to mesh-local emitted-light illumination and SHALL preserve emitter color without introducing white-hot centers, hard white lines, or additive blowout that overpowers nearby voxel surfaces.

#### Scenario: Colored emitter source is highlighted
- **WHEN** a loaded emitting block receives a runtime source accent
- **THEN** the accent color remains visually derived from the emitter RGB color rather than a white sprite core

#### Scenario: Clustered emitters are visible
- **WHEN** several nearby emitters are active in a low-light scene
- **THEN** their runtime accents combine softly without producing hard white seams or lines that dominate the mesh-local light spread

#### Scenario: Lower quality settings are active
- **WHEN** block-light quality settings reduce runtime accent budgets
- **THEN** the viewer preserves mesh-local emitted-light illumination before optional point-light or glow-sprite accents

### Requirement: Mesh-local emitted light is continuous across payload borders
The viewer SHALL bake mesh-local emitted light from payload-owned own-region and halo emitter records so adjacent loaded voxel regions do not show hard emitted-light discontinuities solely because an emitter is owned by one side of a region boundary.

#### Scenario: Adjacent regions contain nearby emitters
- **WHEN** adjacent loaded voxel regions contain emitters whose light radii overlap visible surfaces across their shared boundary
- **THEN** the rendered mesh-local emitted-light contribution remains visually continuous across the boundary apart from normal geometry, material, and occlusion differences

### Requirement: LOD 1 block-light seams remain supported by halo emitters
The `/api/voxels` LOD 1 binary payload SHALL continue to include neighboring halo emitter records when halo emitters are enabled so emitted-light cues can cross voxel region boundaries.

#### Scenario: Neighboring emitter affects region boundary
- **WHEN** a neighboring LOD 1 region contains an emitted-light block within the halo radius of the requested region boundary
- **THEN** the generated voxel payload includes a halo emitter record for that source when it is eligible under the existing halo collection rules

#### Scenario: Diagnostic request disables halo emitters
- **WHEN** a diagnostic voxel request disables halo emitters
- **THEN** the payload omits neighboring halo emitter records while preserving own-region emitter records

### Requirement: Halo optimization does not change the voxel binary emitter layout
Optimizing halo collection SHALL NOT change the encoded binary emitter record layout, halo flag interpretation, coordinate convention, or compression requirements for `/api/voxels`.

#### Scenario: Client decodes optimized halo payload
- **WHEN** the client worker decodes a voxel payload generated by the optimized halo collection path
- **THEN** it consumes emitter records through the existing binary payload decoder without requiring a client binary-format migration

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

### Requirement: Capped LOD 1 payloads retain boundary-relevant halo sources deterministically
When the LOD 1 emitter-record cap is reached, the server SHALL apply a
documented deterministic retention policy that prevents unrelated own-region
records from starving all halo sources relevant to a receiving horizontal
boundary. The policy SHALL define edge allocation or ranking, corner handling,
vertical relevance, and deterministic tie-breaking while retaining the existing
binary emitter-record layout and halo-flag semantics.

#### Scenario: Dense own records compete with a relevant halo source
- **WHEN** a requested LOD 1 region has at least the payload-cap count of unrelated own-region emitters and a neighboring source can illuminate receiving geometry near a horizontal boundary
- **THEN** the capped payload retains the boundary-relevant halo record according to the documented retention policy

#### Scenario: Halo sources occur at a horizontal corner
- **WHEN** halo sources can contribute through a receiving region corner
- **THEN** the retention policy handles the corner deterministically without allowing unrelated edge candidates to starve every relevant corner source

#### Scenario: Halo source is outside the visible vertical relevance range
- **WHEN** a halo candidate cannot reach the requested region's visible geometry under the configured radius and vertical span
- **THEN** the retention policy may prioritize a more relevant candidate without changing the emitter record format

### Requirement: Halo retention policy changes invalidate persistent voxel mesh caches
The server SHALL invalidate persisted voxel mesh entries when the LOD 1
emitter-cap retention policy or any of its selection semantics change, even when
the binary emitter-record layout is unchanged.

#### Scenario: Retention policy implementation changes
- **WHEN** the server changes boundary allocation, relevance ranking, or tie-breaking for capped emitter records
- **THEN** it increments or otherwise changes voxel mesh cache identity before serving payloads generated under the new policy

#### Scenario: Retention policy remains unchanged
- **WHEN** a generation changes only non-semantic execution details while retaining identical record selection
- **THEN** existing cache identity remains valid for that policy
