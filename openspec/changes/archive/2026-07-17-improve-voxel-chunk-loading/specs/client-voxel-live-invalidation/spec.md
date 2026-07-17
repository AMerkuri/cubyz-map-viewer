## ADDED Requirements

### Requirement: Client voxel invalidations are coalesced per received batch
The client SHALL expand and union all affected voxel keys from one received terrain-update batch before changing refresh versions, cancelling work, evicting warm entries, or requesting replacement work. Each affected key SHALL undergo those invalidation side effects at most once for that batch.

#### Scenario: Adjacent LOD 1 regions update together
- **WHEN** one received batch contains adjacent LOD 1 source regions whose halo and ancestor footprints overlap
- **THEN** the client MUST union the complete affected key set before applying invalidation
- **THEN** each overlapping leaf or ancestor key MUST receive one refresh-version increment and at most one direct replacement request for that batch

#### Scenario: Duplicate source coordinates occur in a batch
- **WHEN** one received batch contains the same changed source coordinate more than once
- **THEN** duplicate coordinates MUST NOT cause repeated cancellation, eviction, or refresh side effects

#### Scenario: Separate batches affect the same key
- **WHEN** a later received batch affects a key invalidated by an earlier batch
- **THEN** the later batch MUST produce a newer refresh version so results from the earlier batch cannot overwrite newer world state

### Requirement: Client and server use equivalent voxel halo invalidation footprints
For every supported LOD, the client SHALL mark stale every voxel key whose rendered payload can depend on the changed source region under the server's normal halo and coarse-emitter-summary rules. Footprint alignment SHALL handle negative coordinates and required coarse ancestors deterministically.

#### Scenario: LOD 1 region changes
- **WHEN** an LOD 1 source region changes
- **THEN** the affected client set MUST include every LOD 1 halo neighbor reached by the emitted-light radius and every supported coarse ancestor required by payload derivation

#### Scenario: Coarse region changes
- **WHEN** an LOD 2, 4, 8, 16, or 32 source region changes
- **THEN** the affected client set MUST include same-LOD neighboring payload keys reached by the server's coarse emitter-summary influence radius

#### Scenario: Region coordinates are negative
- **WHEN** a changed source region or affected halo crosses a negative coordinate boundary
- **THEN** client and server footprint mechanics MUST use equivalent floor alignment and produce matching keys

### Requirement: Loaded voxel refresh remains stale-while-revalidate
The client SHALL keep loaded stale voxel geometry available for selection while fetching, base-meshing, and inserting its current replacement. It SHALL reject every result older than the key's current refresh version and SHALL replace stale geometry atomically when current base geometry is scene-ready.

#### Scenario: Loaded tile is invalidated
- **WHEN** a loaded voxel tile is included in a coalesced invalidation set
- **THEN** the client MUST mark it stale without removing its visible geometry
- **THEN** it MUST request or retain demand for a current replacement according to normal LOD selection

#### Scenario: Replacement base becomes scene-ready
- **WHEN** current-version base geometry completes for a loaded stale tile
- **THEN** the client MUST install the current base before disposing the stale tile resources
- **THEN** the transition MUST NOT expose a temporary coverage hole

#### Scenario: Obsolete work completes after invalidation
- **WHEN** an older fetch, base result, enhancement result, or scene-ready item completes after a newer invalidation version exists
- **THEN** the client MUST discard it without changing current visible geometry or freshness state

### Requirement: Invalidation mechanics are hermetically verifiable
The client SHALL expose pure batch expansion and union mechanics that can be verified without a WebSocket, browser worker, WebGL context, running server, or real save.

#### Scenario: Synthetic adjacent update burst is expanded
- **WHEN** a test supplies adjacent and duplicate updates across supported LODs
- **THEN** the resulting affected keys MUST be unique and match the expected halo and ancestor union
- **THEN** simulated invalidation side effects MUST occur once per resulting key

#### Scenario: Client and server footprint fixtures are compared
- **WHEN** contract tests evaluate representative positive, zero, boundary, and negative source coordinates at every supported LOD
- **THEN** client and server invalidation footprint keys MUST match
