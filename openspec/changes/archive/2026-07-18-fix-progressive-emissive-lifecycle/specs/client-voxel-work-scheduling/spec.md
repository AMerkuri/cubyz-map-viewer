## MODIFIED Requirements

### Requirement: Obsolete voxel mesh jobs are cancellable
The client SHALL assign stable job and phase identities to dispatched voxel mesh work. It SHALL cancel fetch and base work that is no longer under active fetch demand, and SHALL cancel enhancement work when its target loaded base tile is no longer retained or its refresh version or base mesh identity has been superseded. Workers SHALL cooperatively observe cancellation during long-running base construction and emissive enhancement and SHALL avoid transferring expanded output for a cancellation observed before final phase transfer.

#### Scenario: Queued base tile leaves active fetch demand
- **WHEN** a voxel tile leaves active fetch demand before its compact base input is dispatched
- **THEN** the client MUST remove its queued base work without running mesh decode
- **THEN** the client MUST release associated scheduler capacity exactly once

#### Scenario: Enhancement target remains current after base becomes fresh
- **WHEN** a progressive base tile becomes fresh and therefore leaves active fetch demand while its matching loaded base tile remains retained
- **THEN** the client MUST NOT cancel queued or running enhancement solely because fetch demand ended

#### Scenario: Enhancement target leaves retained lifecycle
- **WHEN** the base tile targeted by queued or running enhancement is unloaded, moved to warm cache, replaced, made stale, or no longer has the scheduled base mesh identity
- **THEN** the client MUST cancel or reject the enhancement without mutating geometry outside the current loaded tile

#### Scenario: Running base tile leaves active fetch demand
- **WHEN** a tile leaves active fetch demand while a base job is running
- **THEN** the client MUST send cancellation for that base job and phase identity
- **THEN** the worker MUST observe cancellation at a bounded cooperative checkpoint and return a cancellation acknowledgement without the cancelled phase's expanded arrays

#### Scenario: Refresh version is superseded
- **WHEN** a tile receives a newer refresh version while an older fetch, queued input, worker job, scene-ready output, inserted base, or enhancement exists
- **THEN** every older phase MUST become ineligible for scene mutation
- **THEN** queued or running older work MUST be cancelled where cancellation can still avoid work

#### Scenario: Enhancement base identity is superseded
- **WHEN** an enhancement result targets a base mesh that has been replaced, unloaded, or moved out of current refresh identity
- **THEN** the main thread MUST reject and release the enhancement arrays without changing visible geometry

#### Scenario: Cancellation races final result transfer
- **WHEN** cancellation arrives after a worker has committed to transferring a base or enhancement result
- **THEN** the main thread MUST reject the result using job identity, phase identity, tile refresh version, and base identity as applicable
- **THEN** scheduler capacity and queued-output accounting MUST still be released exactly once
