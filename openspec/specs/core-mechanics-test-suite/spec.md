## Purpose

Define hermetic correctness coverage for core map-viewer runtime mechanics.

## Requirements

### Requirement: Voxel service orchestration coverage
The test suite SHALL deterministically verify voxel service cache reuse, same-key in-flight request deduplication, compressed representation identity, hierarchical invalidation, and rejection of results made stale by key or global invalidation.

#### Scenario: Concurrent identical requests
- **WHEN** multiple voxel requests for the same versioned key arrive before generation completes
- **THEN** the tests verify that one generation job supplies all requests and that the completed result becomes reusable

#### Scenario: In-flight result becomes stale
- **WHEN** a key or all keys are invalidated while generation is pending
- **THEN** the tests verify that the eventual old result does not repopulate the active cache

#### Scenario: Encoded variants
- **WHEN** Brotli and gzip representations are requested for one generated voxel mesh
- **THEN** the tests verify that each representation has the correct stable bytes and ETag and that repeated requests reuse its cached variant

#### Scenario: LOD 1 emitter invalidation
- **WHEN** an LOD 1 region changes at positive, zero, or negative coordinates
- **THEN** the tests verify invalidation of exposure-dependent leaves and every correctly aligned summary ancestor through LOD 32

### Requirement: Voxel HTTP contract coverage
The test suite SHALL verify voxel route validation, content negotiation, conditional response, cache, empty-result, and diagnostic halo behavior through an Express HTTP boundary.

#### Scenario: Supported compression is required
- **WHEN** a voxel request advertises neither Brotli nor gzip with positive quality
- **THEN** the tests verify a 406 response without requesting a voxel representation from the service

#### Scenario: Encoding quality negotiation
- **WHEN** a request advertises Brotli, gzip, wildcard, exclusions, or unequal quality weights
- **THEN** the tests verify selection of the accepted representation with the expected preference and tie behavior

#### Scenario: Conditional voxel response
- **WHEN** `If-None-Match` matches the ETag for the negotiated representation
- **THEN** the tests verify a 304 response with the ETag, cache policy, and `Vary: Accept-Encoding`

#### Scenario: Empty voxel response
- **WHEN** the service reports that an aligned region has no voxel payload
- **THEN** the tests verify a 204 response with a no-store cache policy

#### Scenario: Diagnostic halo isolation
- **WHEN** the request includes `halo=0`
- **THEN** the tests verify that the route uses the diagnostic cache identity and asks the service to omit halo emitters

#### Scenario: Invalid region addressing
- **WHEN** route or metrics parameters contain an unsupported LOD, non-finite value, incomplete coordinate triple, or coordinate not aligned to its LOD span
- **THEN** the tests verify a client error and no generation request

### Requirement: Client live-update coverage
The test suite SHALL verify that terrain and voxel update notifications invalidate all dependent cached, queued, loading, and rendered state before authoritative refresh work is requested.

#### Scenario: Terrain gutter neighborhood changes
- **WHEN** one terrain tile changes
- **THEN** the tests verify invalidation and eviction of its same-LOD 3 by 3 gutter neighborhood and reload only when terrain is enabled

#### Scenario: LOD 1 voxel region changes
- **WHEN** an LOD 1 voxel region changes
- **THEN** the tests verify that halo-neighbor leaves and their aligned LOD 2 through LOD 32 ancestors become stale and eligible loaded or available regions receive direct refreshes

#### Scenario: Obsolete work is cancelled
- **WHEN** an affected voxel key has an active fetch or queued fetch and mesh work
- **THEN** the tests verify abortion or removal of obsolete work while preserving only work at the current refresh version

#### Scenario: Negative-coordinate update
- **WHEN** an update occurs immediately below a world-coordinate alignment boundary
- **THEN** the tests verify floor-aligned leaf and ancestor identities without duplicate refreshes

### Requirement: Save watcher semantic coverage
The test suite SHALL verify that save filesystem paths produce debounced and deduplicated semantic update events for supported positive and negative world coordinates.

#### Scenario: Surface file lifecycle
- **WHEN** an aligned surface file is changed, added, or removed
- **THEN** the tests verify the appropriate tile batch update and surface-index notification semantics

#### Scenario: Region column lifecycle
- **WHEN** one or more vertical `.region` files in a region column change, are added, or are removed
- **THEN** the tests verify one deduplicated `{lod, regionX, regionY}` update for that column

#### Scenario: Player and world debounce
- **WHEN** multiple player or world metadata events occur inside one debounce window
- **THEN** the tests verify one semantic event of the correct type

#### Scenario: Watcher shutdown
- **WHEN** the watcher stops with pending debounce or terrain batch work
- **THEN** the tests verify that no pending update is emitted afterward

#### Scenario: Invalid save path
- **WHEN** a path has an unsupported layout, LOD, extension, or coordinate alignment
- **THEN** the tests verify that no semantic update is emitted

### Requirement: Terrain seam contract coverage
The test suite SHALL pass deterministic adjacent same-LOD surface fixtures through the production terrain server/client boundary and verify seam-safe geometry and gutter-dependent refresh behavior.

#### Scenario: Adjacent tile border continuity
- **WHEN** two neighboring synthetic surface tiles are parsed and built
- **THEN** the tests identify matching shared-border vertices and verify equal world positions and seam-compatible normals

#### Scenario: Gutter source changes
- **WHEN** a source surface tile changes data used by its neighbor's one-vertex gutter
- **THEN** the tests verify that the neighboring tile is included in invalidation and rebuild coverage

### Requirement: Hermetic focused test commands
The project SHALL provide a default correctness command that includes existing voxel tests and all new core-mechanics suites, plus focused commands suitable for investigating each ownership boundary.

#### Scenario: Default correctness run
- **WHEN** a contributor runs `npm test` in a checkout with dependencies installed
- **THEN** all correctness suites run without a real Cubyz save, Cubyz installation, browser, WebGL context, or running application server

#### Scenario: Focused investigation
- **WHEN** a contributor runs a documented focused core-mechanics test command
- **THEN** only the corresponding service/API, watcher, client runtime, or terrain contract group runs
