## MODIFIED Requirements

### Requirement: Capped LOD 1 payloads retain boundary-relevant halo sources deterministically
When the LOD 1 emitter-record cap is reached, the server SHALL apply a documented deterministic retention policy that prevents unrelated own-region records or unrelated halo candidates from starving halo sources relevant to visible receiving horizontal boundary geometry. The policy SHALL rank or reserve edge and corner candidates according to their configured emitted-light influence over generated opaque boundary geometry, including Y/Z locality, before using deterministic fallback ordering. The policy SHALL define edge allocation, corner handling, vertical relevance, and deterministic tie-breaking while retaining the existing binary emitter-record layout and halo-flag semantics.

#### Scenario: Dense own records compete with a relevant halo source
- **WHEN** a requested LOD 1 region has at least the payload-cap count of unrelated own-region emitters and a neighboring source can illuminate receiving geometry near a horizontal boundary
- **THEN** the capped payload retains the boundary-relevant halo record according to the documented retention policy

#### Scenario: Dense halo candidates share one edge distance
- **WHEN** multiple halo emitters lie at the same horizontal distance beyond a receiving edge but only some can illuminate visible receiving boundary geometry at the relevant Y/Z locations
- **THEN** the capped payload retains the geometry-relevant sources before deterministic fallback candidates that cannot illuminate those boundary surfaces

#### Scenario: Halo sources occur at a horizontal corner
- **WHEN** halo sources can contribute through a receiving region corner
- **THEN** the retention policy handles the corner deterministically without allowing unrelated edge candidates to starve every relevant corner source

#### Scenario: Halo source is outside the visible vertical relevance range
- **WHEN** a halo candidate cannot reach the requested region's visible geometry under the configured emitted-light radius and vertical span
- **THEN** the retention policy may prioritize a more relevant candidate without changing the emitter record format

### Requirement: Halo retention policy changes invalidate persistent voxel mesh caches
The server SHALL invalidate persisted voxel mesh entries when the LOD 1 emitter-cap retention policy or any of its selection semantics change, even when the binary emitter-record layout is unchanged.

#### Scenario: Retention policy implementation changes
- **WHEN** the server changes boundary allocation, geometry relevance ranking, or tie-breaking for capped emitter records
- **THEN** it increments or otherwise changes voxel mesh cache identity before serving payloads generated under the new policy

#### Scenario: Retention policy remains unchanged
- **WHEN** a generation changes only non-semantic execution details while retaining identical record selection
- **THEN** existing cache identity remains valid for that policy

### Requirement: Coarse payloads retain boundary-reaching summary representatives
LOD `2` through `32` payloads SHALL include deterministic same-LOD neighboring summary representatives whose configured world-space influence reaches the requested payload footprint. Neighboring representatives SHALL remain payload-local bake inputs rather than duplicate runtime accent owners, and every contributing summary signature SHALL participate in voxel cache identity.

#### Scenario: A coarse representative crosses a region boundary
- **WHEN** a summary representative owned by one coarse region can illuminate visible geometry in an adjacent coarse region
- **THEN** both payloads include an equivalent world-space representative for mesh-local baking

#### Scenario: A neighboring representative cannot reach the payload
- **WHEN** the representative's configured radius does not intersect the requested coarse footprint
- **THEN** the server omits it from that payload

#### Scenario: A contributing neighboring summary changes
- **WHEN** a same-LOD neighboring summary used by a coarse payload changes
- **THEN** that payload's source signature, ETag, persistent cache identity, and live invalidation coverage change accordingly
