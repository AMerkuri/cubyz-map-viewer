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

### Requirement: Voxel payload includes compact LOD 1 emitter records
The `/api/voxels` binary payload SHALL include compact block-light emitter records for LOD 1 regions, derived from block values whose palette index has non-zero emitted-light metadata.

#### Scenario: LOD 1 region contains emitting blocks
- **WHEN** the server generates a LOD 1 voxel mesh for a region containing blocks with non-zero emitted light
- **THEN** the encoded payload includes emitter records with region-local block coordinates and emitted RGB color for those blocks

#### Scenario: Coarser LOD region contains emitting blocks
- **WHEN** the server generates a voxel mesh for a region at LOD greater than 1
- **THEN** the encoded payload MUST omit per-block emitter records unless a future aggregation requirement is defined

#### Scenario: Region has no emitting blocks
- **WHEN** the server generates a voxel mesh for a region with no non-zero emitted-light blocks
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
Voxel mesh cache keys SHALL distinguish emitted-light metadata and emitted-light rendering semantics so stale geometry-only, stale-color, stale-emitter, or stale-local-light payloads are not reused after emitter-relevant changes.

#### Scenario: Emitted-light metadata changes
- **WHEN** layered block assets change the `.emittedLight` value for a palette entry
- **THEN** generated voxel payloads and any derived local-light presentation reflect the current emitted-light color rather than a stale cached value

#### Scenario: Emitter payload format changes
- **WHEN** the binary emitter record layout or interpretation changes
- **THEN** previously persisted voxel mesh cache entries generated with the old layout are not reused

#### Scenario: Local-light rendering semantics change
- **WHEN** server-generated or client-decoded voxel payload semantics change for baked or mesh-local emitted-light contribution
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
The viewer SHALL render block-emissive lighting as a bounded Cubyz-like local illumination approximation where emitted blocks affect nearby voxel surfaces through baked or mesh-local light contribution, while dynamic point lights and glow sprites remain optional accents rather than the primary lighting model.

#### Scenario: Nighttime scene contains emitting blocks
- **WHEN** the active atmosphere is in a low-light state and loaded LOD 1 regions contain emitter records
- **THEN** emitting blocks remain visibly self-lit or glow-tinted and nearby terrain or voxel surfaces receive local emitted-light color that is integrated into their rendered face colors or equivalent mesh-local lighting

#### Scenario: Multiple emitters illuminate nearby surfaces
- **WHEN** nearby loaded LOD 1 emitters contribute to the same visible voxel surface
- **THEN** the viewer combines their bounded local-light contributions without requiring an unbounded number of Three.js point lights

#### Scenario: Loaded emitters exceed rendering budget
- **WHEN** the number of loaded emitter records exceeds the active block-light rendering budget
- **THEN** the viewer preserves bounded local surface illumination for loaded voxel geometry and limits only optional runtime accents such as point lights, glow sprites, or other nonessential effects to preserve scene responsiveness

#### Scenario: Block-emissive lighting is disabled or unavailable
- **WHEN** block-emissive lighting is disabled by quality settings or unsupported by the decoded payload
- **THEN** voxel rendering continues using existing atmosphere, vertex colors, AO, and scene lighting without failing

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
