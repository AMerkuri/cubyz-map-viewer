## ADDED Requirements

### Requirement: Capped LOD 1 payloads retain boundary-relevant halo sources deterministically
When the LOD 1 emitter-record cap is reached, the server SHALL apply a
documented deterministic retention policy that prevents unrelated own-region
records from starving all halo sources relevant to a receiving horizontal
boundary. The policy SHALL define edge allocation or ranking, corner handling,
vertical relevance, and deterministic tie-breaking while retaining the existing
binary emitter-record layout and halo-flag semantics.

#### Scenario: Dense own records compete with a relevant halo source
- **WHEN** a requested LOD 1 region has at least the payload-cap count of unrelated own-region emitters and a neighboring source can illuminate receiving geometry near a horizontal boundary
- **THEN** the capped payload retains the boundary-relevant halo record according to the documented retention policy

#### Scenario: Halo sources occur at a horizontal corner
- **WHEN** halo sources can contribute through a receiving region corner
- **THEN** the retention policy handles the corner deterministically without allowing unrelated edge candidates to starve every relevant corner source

#### Scenario: Halo source is outside the visible vertical relevance range
- **WHEN** a halo candidate cannot reach the requested region's visible geometry under the configured radius and vertical span
- **THEN** the retention policy may prioritize a more relevant candidate without changing the emitter record format

### Requirement: Halo retention policy changes invalidate persistent voxel mesh caches
The server SHALL invalidate persisted voxel mesh entries when the LOD 1
emitter-cap retention policy or any of its selection semantics change, even when
the binary emitter-record layout is unchanged.

#### Scenario: Retention policy implementation changes
- **WHEN** the server changes boundary allocation, relevance ranking, or tie-breaking for capped emitter records
- **THEN** it increments or otherwise changes voxel mesh cache identity before serving payloads generated under the new policy

#### Scenario: Retention policy remains unchanged
- **WHEN** a generation changes only non-semantic execution details while retaining identical record selection
- **THEN** existing cache identity remains valid for that policy
