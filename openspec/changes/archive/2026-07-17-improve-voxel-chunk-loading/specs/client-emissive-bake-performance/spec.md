## ADDED Requirements

### Requirement: Base voxel geometry becomes usable before optional emissive enhancement
The client worker pipeline SHALL support a base phase that produces complete renderable voxel geometry without waiting for mesh-local emissive attribute baking. When emissive enhancement is enabled and applicable, it SHALL run as independently prioritized work after the base result and SHALL NOT prevent more urgent base work from using available worker capacity.

#### Scenario: Payload contains expensive emissive work
- **WHEN** a demanded voxel payload contains geometry and emitter records requiring mesh-local emissive baking
- **THEN** the worker MUST be able to return complete base geometry before emissive attributes are calculated
- **THEN** the client MUST be able to insert and select that base geometry visible while enhancement remains pending

#### Scenario: Urgent base work arrives while enhancement waits
- **WHEN** optional enhancement and higher-priority base work are both eligible for limited worker capacity
- **THEN** the higher-priority base work MUST dispatch first

#### Scenario: Emissive attributes are disabled or unnecessary
- **WHEN** emissive baking is disabled or the base result has no quadrant requiring enhancement
- **THEN** the pipeline MUST complete the tile without scheduling an enhancement phase

### Requirement: Emissive enhancement attaches version-safe attributes
The client SHALL attach a completed emissive enhancement only to the current base geometry identity for the same tile refresh version. Attachment SHALL preserve normalized attribute semantics and SHALL not remove or replace visible base geometry while enhancement is pending.

#### Scenario: Current enhancement completes
- **WHEN** enhancement arrays complete for the current refresh version and matching base mesh identity
- **THEN** the client MUST attach each non-empty normalized emissive attribute to its corresponding current quadrant geometry
- **THEN** visible base geometry MUST remain present throughout attachment

#### Scenario: Tile changes while enhancement runs
- **WHEN** the tile is refreshed, unloaded, replaced, or invalidated before its enhancement attaches
- **THEN** the enhancement result MUST be discarded and released without mutating the newer or unrelated geometry

#### Scenario: Updated tile replaces stale visible geometry
- **WHEN** stale visible geometry is being refreshed and its current base phase completes
- **THEN** the new base geometry MUST atomically replace the stale tile before optional enhancement completes
- **THEN** failure or cancellation of enhancement MUST leave the current base geometry usable

### Requirement: Progressive emissive phases remain bounded and observable
The client SHALL account retained compact enhancement input, active enhancement work, enhancement output, and rejected enhancement arrays within scheduler capacity and diagnostics. Compact input ownership SHALL not be cloned solely to move enhancement between workers.

#### Scenario: Base worker returns compact ownership
- **WHEN** a base phase completes and enhancement remains eligible
- **THEN** ownership of the original compact input MUST return or transfer into scheduler-managed enhancement state without cloning the complete buffer
- **THEN** retained compact bytes MUST remain included in compact-stage memory accounting

#### Scenario: Enhancement is cancelled or rejected
- **WHEN** enhancement is cancelled, fails, or loses its target base identity
- **THEN** retained compact and expanded enhancement resources MUST be released exactly once
- **THEN** diagnostics MUST record the terminal phase and reason

#### Scenario: Base and enhancement performance are compared
- **WHEN** diagnostics capture a progressive mesh sample
- **THEN** base execution, selection-to-base-visible, enhancement execution, selection-to-enhanced, retained compact bytes, and emissive output bytes MUST be independently observable
