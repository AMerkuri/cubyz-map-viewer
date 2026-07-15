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

### Requirement: Halo optimization preserves emitter record semantics while allowing documented capped selection
The server SHALL preserve the LOD 1 binary voxel emitter-record layout, halo-flag interpretation, coordinate convention, color semantics, and open-face semantics while optimizing how neighboring source data is loaded. A documented capped-record retention policy MAY change which eligible records are retained, provided that it is deterministic, boundary-aware, cache-invalidating, and satisfies the block-emissive lighting halo-retention requirements.

#### Scenario: Region has neighboring visible emitters below the payload cap
- **WHEN** LOD 1 voxel generation includes halo emitters for neighboring emitted-light blocks and the payload cap does not require selection
- **THEN** the encoded payload includes halo emitter records with the existing coordinate, color, open-face, and halo flag semantics

#### Scenario: Capped payload selects halo emitters
- **WHEN** eligible own-region and halo records exceed the LOD 1 payload cap
- **THEN** the server retains records according to the documented deterministic retention policy without changing the binary emitter record layout

#### Scenario: Optimized and unoptimized collection touch the same uncapped source data
- **WHEN** the optimized loader reads the same source `.region` files as the previous collection path and the payload cap does not require selection
- **THEN** it emits behaviorally equivalent halo emitter records for the same source blocks

### Requirement: Halo collection reports verification metrics
The server SHALL expose aggregate metrics sufficient to verify that halo collection is reusing external region data and reducing repeated parse work.

#### Scenario: Voxel generation completes with halo enabled
- **WHEN** an LOD 1 voxel mesh is generated with halo emitters enabled
- **THEN** server-side generation metrics include halo timing and aggregate external-region cache/load counters

#### Scenario: Voxel generation completes with halo disabled
- **WHEN** an LOD 1 diagnostic voxel mesh is generated with halo emitters disabled
- **THEN** halo-specific metrics clearly indicate that halo collection was skipped or not applicable

### Requirement: Halo traversal reuse preserves traversal semantics
The server SHALL reuse halo traversability results within an LOD 1 generation
job without changing how missing chunks, out-of-range Z coordinates, block
shapes, transparent blocks, model blocks, or semantic blocks determine an
emitter's open faces.

#### Scenario: Multiple halo emitters query the same traversability cell
- **WHEN** halo open-face checks query the same target or external cell during one generation job
- **THEN** the server reuses the cached traversability result while producing the same open-face semantics as the uncached path

#### Scenario: Halo neighbor is unavailable or structurally special
- **WHEN** an open-face check encounters a missing external chunk, out-of-range Z coordinate, transparent block, model block, or semantic block
- **THEN** the optimized traversal path returns the same traversability result as the existing generator semantics

### Requirement: Halo retention is validated across boundaries and cap pressure
The server SHALL provide repeatable validation coverage for halo source
retention and emitted-light continuity across X/Y boundaries, horizontal
corners, vertical scan extremes, dense own-record cap pressure, dense regions
on both sides of a shared edge, and missing-neighbor traversal behavior.

#### Scenario: Seam validation runs under cap pressure
- **WHEN** validation generates a receiving region with at least the LOD 1 payload-cap count of unrelated own-region records and boundary-relevant halo emitters
- **THEN** it verifies the decoded payload retains the expected halo records and the designated receiving geometry receives non-zero baked light

#### Scenario: Seam validation covers uncapped and capped cases
- **WHEN** validation exercises each required boundary-placement case
- **THEN** it runs the case both below the emitter-record cap and with cap pressure and records deterministic payload and fixed-camera render outcomes

### Requirement: Halo source discovery avoids neighboring mesh generation
LOD 1 halo collection SHALL obtain represented sources for neighboring columns without constructing neighboring mesh faces, merged geometry, boundary geometry samples, encoded voxel payloads, or persistent voxel meshes. It SHALL retain bounded resolved and in-flight reuse of equivalent neighboring extraction work.

#### Scenario: Cold neighboring column contains emitters
- **WHEN** halo collection needs represented sources from a neighboring populated LOD 1 column with no resolved worker-local source entry
- **THEN** the worker performs lightweight emitter extraction and does not recursively generate a complete neighboring mesh

#### Scenario: Neighboring source extraction is shared
- **WHEN** concurrent or repeated halo lookups in one worker need the same valid neighboring source key
- **THEN** they share in-flight or bounded resolved extractor output according to the worker emitter-cache contract

#### Scenario: Neighboring column is missing or empty
- **WHEN** a halo neighbor has no valid populated voxel column
- **THEN** extraction returns no represented sources without allocating geometry output

### Requirement: Lightweight halo extraction preserves source semantics
The lightweight extractor SHALL preserve emitted color, world coordinates, represented LODs, shape-sensitive traversability, and open-face behavior required to produce existing halo emitter records. The normal LOD 1 binary emitter layout, cap policy, halo flag, and cache invalidation behavior SHALL remain unchanged.

#### Scenario: Existing uncapped halo fixture is regenerated
- **WHEN** the lightweight path processes the same target and neighboring source data as the prior full-generation path
- **THEN** the decoded uncapped halo emitter records are behaviorally equivalent

#### Scenario: Special block shapes affect open faces
- **WHEN** neighboring extraction encounters transparent, model, semantic, missing, or out-of-range cells during source open-face evaluation
- **THEN** it produces the same traversability and open-face result required by existing halo traversal semantics

#### Scenario: Neighbor source changes
- **WHEN** a watched neighboring column changes its source signature
- **THEN** stale resolved extractor output is not reused for a normal halo-enabled payload
