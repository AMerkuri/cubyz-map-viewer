## MODIFIED Requirements

### Requirement: Voxel payload includes compact LOD 1 emitter records
The `/api/voxels` binary payload SHALL include compact block-light emitter records for LOD 1 regions, derived from block values whose palette index has non-zero emitted-light metadata. For voxel LODs greater than 1, the payload SHALL include bounded aggregated emitter records for strong or clustered emitted-light sources when those records are needed to preserve important distant light cues.

#### Scenario: LOD 1 region contains emitting blocks
- **WHEN** the server generates a LOD 1 voxel mesh for a region containing blocks with non-zero emitted light
- **THEN** the encoded payload includes emitter records with region-local block coordinates and emitted RGB color for those blocks

#### Scenario: Coarser LOD region contains important emitting blocks
- **WHEN** the server generates a voxel mesh for a region at LOD greater than 1 and the source data contains strong or clustered emitting blocks
- **THEN** the encoded payload includes bounded aggregated emitter records representing those important light sources instead of always omitting emitter records

#### Scenario: Coarser LOD region contains only weak or sparse emitting blocks
- **WHEN** the server generates a voxel mesh for a region at LOD greater than 1 and the source data contains only weak or sparse emitters below the aggregation threshold
- **THEN** the encoded payload MAY omit those emitters to preserve payload and runtime budgets

#### Scenario: Region has no emitting blocks
- **WHEN** the server generates a voxel mesh for a region with no non-zero emitted-light blocks
- **THEN** the encoded payload represents an empty emitter set without requiring a separate request

### Requirement: Emitter metadata participates in voxel cache validity
Voxel mesh cache keys SHALL distinguish emitted-light metadata, emitter payload format, and LOD aggregation behavior so stale geometry-only, stale-color, stale-format, or stale-aggregation payloads are not reused after emitter-relevant changes.

#### Scenario: Emitted-light metadata changes
- **WHEN** layered block assets change the `.emittedLight` value for a palette entry
- **THEN** generated voxel payloads reflect the current emitted-light color rather than a stale cached value

#### Scenario: Emitter payload format changes
- **WHEN** the binary emitter record layout or interpretation changes
- **THEN** previously persisted voxel mesh cache entries generated with the old layout are not reused

#### Scenario: Coarser LOD aggregation behavior changes
- **WHEN** aggregation thresholds, grouping, or encoded representative emitter behavior changes for LODs greater than 1
- **THEN** previously persisted coarser LOD voxel mesh cache entries generated with old aggregation behavior are not reused
