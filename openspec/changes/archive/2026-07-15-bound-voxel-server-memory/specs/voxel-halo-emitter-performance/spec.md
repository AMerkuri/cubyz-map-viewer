## ADDED Requirements

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
