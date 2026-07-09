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

### Requirement: Emitter metadata participates in voxel cache validity
Voxel mesh cache keys SHALL distinguish emitted-light metadata and emitter payload format so stale geometry-only or stale-color payloads are not reused after emitter-relevant changes.

#### Scenario: Emitted-light metadata changes
- **WHEN** layered block assets change the `.emittedLight` value for a palette entry
- **THEN** generated voxel payloads reflect the current emitted-light color rather than a stale cached value

#### Scenario: Emitter payload format changes
- **WHEN** the binary emitter record layout or interpretation changes
- **THEN** previously persisted voxel mesh cache entries generated with the old layout are not reused

### Requirement: Client decodes and owns emitter lifecycle per voxel region
The client voxel worker SHALL decode emitter records from voxel payloads and the world-view runtime SHALL reconcile rendered emitter effects with loaded LOD 1 voxel regions.

#### Scenario: Region with emitters loads
- **WHEN** a LOD 1 voxel region payload with emitter records is decoded and uploaded
- **THEN** the client associates those emitters with the loaded voxel region and makes them available to the block-light rendering runtime

#### Scenario: Region with emitters unloads or refreshes
- **WHEN** a voxel region is unloaded, replaced, or invalidated by world updates
- **THEN** the client removes or replaces the emitter effects owned by that region without leaving stale scene objects

### Requirement: Viewer renders bounded block-emissive lighting
The viewer SHALL render block-emissive lighting as a bounded visual approximation that improves low-light readability without requiring exact Cubyz light propagation.

#### Scenario: Nighttime scene contains emitting blocks
- **WHEN** the active atmosphere is in a low-light state and loaded LOD 1 regions contain emitter records
- **THEN** emitting blocks remain visibly self-lit or glow-tinted and nearby terrain or voxel surfaces receive a bounded local-light impression

#### Scenario: Loaded emitters exceed rendering budget
- **WHEN** the number of loaded emitter records exceeds the active block-light rendering budget
- **THEN** the viewer prioritizes a bounded subset or cheaper representation while preserving scene responsiveness

#### Scenario: Block-emissive lighting is disabled or unavailable
- **WHEN** block-emissive lighting is disabled by quality settings or unsupported by the decoded payload
- **THEN** voxel rendering continues using existing atmosphere, vertex colors, AO, and scene lighting without failing

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
