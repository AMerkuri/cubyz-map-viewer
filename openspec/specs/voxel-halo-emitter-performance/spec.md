## Purpose

Define performance expectations for LOD 1 halo emitter collection so neighboring emitted-light source data is reused within a single voxel mesh generation job, payload semantics are preserved, and verification metrics are available.

## Requirements

### Requirement: LOD 1 halo collection reuses external region data within a generation job
The server SHALL avoid reparsing the same external voxel `.region` file multiple times within a single LOD 1 voxel mesh generation job when collecting halo emitters or querying neighboring cells.

#### Scenario: Multiple external chunks share a region file
- **WHEN** LOD 1 voxel generation reads multiple neighboring chunks from the same external `.region` file
- **THEN** the generation job reuses the parsed region data instead of parsing that file independently for each chunk access

#### Scenario: Halo open-face checks query neighboring cells
- **WHEN** halo emitter open-face checks need traversability from external chunks already loaded during the same generation job
- **THEN** those checks use the same generation-local external region cache

### Requirement: Halo optimization preserves emitted-light payload semantics
The server SHALL preserve the existing LOD 1 binary voxel payload semantics for own-region and halo emitter records while optimizing how neighboring source data is loaded.

#### Scenario: Region has neighboring visible emitters
- **WHEN** LOD 1 voxel generation includes halo emitters for neighboring emitted-light blocks
- **THEN** the encoded payload continues to include halo emitter records with the existing coordinate, color, open-face, and halo flag semantics

#### Scenario: Optimized and unoptimized collection touch the same source data
- **WHEN** the optimized loader reads the same source `.region` files as the previous collection path
- **THEN** it emits behaviorally equivalent halo emitter records for the same source blocks

### Requirement: Halo collection reports verification metrics
The server SHALL expose aggregate metrics sufficient to verify that halo collection is reusing external region data and reducing repeated parse work.

#### Scenario: Voxel generation completes with halo enabled
- **WHEN** an LOD 1 voxel mesh is generated with halo emitters enabled
- **THEN** server-side generation metrics include halo timing and aggregate external-region cache/load counters

#### Scenario: Voxel generation completes with halo disabled
- **WHEN** an LOD 1 diagnostic voxel mesh is generated with halo emitters disabled
- **THEN** halo-specific metrics clearly indicate that halo collection was skipped or not applicable
