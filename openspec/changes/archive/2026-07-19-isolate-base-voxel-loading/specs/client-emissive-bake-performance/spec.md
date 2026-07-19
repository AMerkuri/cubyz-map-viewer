## MODIFIED Requirements

### Requirement: Base voxel geometry becomes usable before optional emissive enhancement
The client worker pipeline SHALL support a base phase that produces complete renderable voxel geometry without waiting for mesh-local emissive attribute baking. When emissive enhancement is enabled and applicable, it SHALL remain independently schedulable after the base result but SHALL NOT consume base-reserved fetch, compact-input, worker, or scene capacity while executable base work remains anywhere in the protected loading lifecycle. A current enhancement SHALL remain eligible after its base geometry becomes fresh and leaves fetch-request demand while its loaded-base target remains valid.

#### Scenario: Payload contains expensive emissive work
- **WHEN** a demanded voxel payload contains geometry and emitter records requiring mesh-local emissive baking
- **THEN** the worker MUST be able to return complete base geometry before emissive attributes are calculated
- **THEN** the client MUST be able to insert and select that base geometry visible while enhancement remains pending

#### Scenario: Fresh base leaves fetch demand before enhancement completes
- **WHEN** a progressive base tile is inserted and the next LOD reconciliation removes its fresh key from fetch-request demand
- **THEN** the client MUST retain, defer, or continue the enhancement while the same loaded base tile, refresh version, and base mesh identity remain current
- **THEN** the completed enhancement MUST remain eligible for normal version-safe attachment

#### Scenario: Base work exists outside the compact queue
- **WHEN** optional enhancement is ready but executable base work is selected, fetch-queued, fetching, worker-active, or scene-ready without a compact base candidate at that instant
- **THEN** the client MUST continue treating base loading as outstanding
- **THEN** enhancement MUST NOT take base-reserved admission or worker capacity under the normal isolation policy

#### Scenario: Base lifecycle settles
- **WHEN** no requestable, queued, active, or scene-ready executable base work remains for the current stable selection
- **THEN** valid retained enhancement MUST become eligible to use available worker capacity according to enhancement priority and bounded storage rules

#### Scenario: Emissive attributes are disabled or unnecessary
- **WHEN** emissive baking is disabled or the base result has no quadrant requiring enhancement
- **THEN** the pipeline MUST complete the tile without scheduling an enhancement phase
