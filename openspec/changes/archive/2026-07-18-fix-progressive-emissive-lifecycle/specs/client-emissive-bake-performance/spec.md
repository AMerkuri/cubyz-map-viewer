## MODIFIED Requirements

### Requirement: Base voxel geometry becomes usable before optional emissive enhancement
The client worker pipeline SHALL support a base phase that produces complete renderable voxel geometry without waiting for mesh-local emissive attribute baking. When emissive enhancement is enabled and applicable, it SHALL run as independently prioritized work after the base result and SHALL NOT prevent more urgent base work from using available worker capacity. A current enhancement SHALL remain eligible after its base geometry becomes fresh and leaves fetch-request demand while its loaded-base target remains valid.

#### Scenario: Payload contains expensive emissive work
- **WHEN** a demanded voxel payload contains geometry and emitter records requiring mesh-local emissive baking
- **THEN** the worker MUST be able to return complete base geometry before emissive attributes are calculated
- **THEN** the client MUST be able to insert and select that base geometry visible while enhancement remains pending

#### Scenario: Fresh base leaves fetch demand before enhancement completes
- **WHEN** a progressive base tile is inserted and the next LOD reconciliation removes its fresh key from fetch-request demand
- **THEN** the client MUST retain or continue the enhancement while the same loaded base tile, refresh version, and base mesh identity remain current
- **THEN** the completed enhancement MUST remain eligible for normal version-safe attachment

#### Scenario: Urgent base work arrives while enhancement waits
- **WHEN** optional enhancement and higher-priority base work are both eligible for limited worker capacity
- **THEN** the higher-priority base work MUST dispatch first

#### Scenario: Emissive attributes are disabled or unnecessary
- **WHEN** emissive baking is disabled or the base result has no quadrant requiring enhancement
- **THEN** the pipeline MUST complete the tile without scheduling an enhancement phase

### Requirement: Emissive enhancement attaches version-safe attributes
The client SHALL attach a completed emissive enhancement only to the current base geometry identity for the same tile refresh version. Attachment SHALL preserve normalized attribute semantics and SHALL not remove or replace visible base geometry while enhancement is pending. Fetch-request membership alone MUST NOT invalidate an enhancement targeting a current retained loaded base tile.

#### Scenario: Current enhancement completes
- **WHEN** enhancement arrays complete for the current refresh version and matching base mesh identity
- **THEN** the client MUST attach each non-empty normalized emissive attribute to its corresponding current quadrant geometry
- **THEN** visible base geometry MUST remain present throughout attachment

#### Scenario: Current fresh base has no fetch request
- **WHEN** enhancement arrays complete after the matching loaded base tile has become fresh and is absent from fetch-request demand
- **THEN** the client MUST attach the arrays when the tile remains loaded, fresh, and matched by refresh version and base mesh identity

#### Scenario: Tile changes while enhancement runs
- **WHEN** the tile is refreshed, unloaded, replaced, or invalidated before its enhancement attaches
- **THEN** the enhancement result MUST be discarded and released without mutating the newer or unrelated geometry

#### Scenario: Updated tile replaces stale visible geometry
- **WHEN** stale visible geometry is being refreshed and its current base phase completes
- **THEN** the new base geometry MUST atomically replace the stale tile before optional enhancement completes
- **THEN** failure or cancellation of enhancement MUST leave the current base geometry usable
