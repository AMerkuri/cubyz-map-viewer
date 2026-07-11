## MODIFIED Requirements

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

## ADDED Requirements

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
