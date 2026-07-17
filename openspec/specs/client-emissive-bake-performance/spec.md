## Purpose

Define client worker emissive bake performance requirements for mesh-local emitted light, including hot-path lookup behavior, culling, compact attribute output, and diagnostic metrics.

## Requirements

### Requirement: Emissive baking avoids allocation-heavy hot-path grid lookups
The client voxel worker SHALL bake mesh-local emitted light using emitter lookup structures that avoid string allocation in the per-vertex accumulation hot path.

#### Scenario: Worker bakes emissive attributes for a cached payload
- **WHEN** the worker processes a voxel payload with emissive attributes enabled and emitter records present
- **THEN** per-vertex emitter neighborhood lookup uses numeric indexing or an equivalent allocation-conscious lookup structure

### Requirement: Emissive baking conservatively skips unlit quads
The client voxel worker SHALL avoid per-vertex emitted-light accumulation for opaque quads that cannot receive contribution from any payload emitter under the configured emitted-light radius.

#### Scenario: Quad is outside all emitter influence
- **WHEN** an opaque quad's bounds cannot intersect any emitter radius
- **THEN** the worker writes normal geometry attributes without evaluating per-vertex emitted-light contribution for that quad

#### Scenario: Quad may intersect emitter influence
- **WHEN** an opaque quad's bounds may intersect one or more emitter radii
- **THEN** the worker evaluates emitted-light contribution conservatively so visible light is not dropped

### Requirement: Emissive attributes use compact normalized representation
The client voxel worker SHALL emit mesh-local emissive attributes in a compact normalized integer representation when visual quality remains compatible with the existing float representation.

#### Scenario: Lit quadrant is emitted by the worker
- **WHEN** a quadrant contains non-zero baked emissive contribution
- **THEN** the worker returns an emissive attribute typed array that the main thread uploads as a normalized attribute preserving `0..1` shader input semantics

#### Scenario: Quadrant receives no emissive contribution
- **WHEN** a quadrant contains no non-zero baked emissive contribution
- **THEN** the worker omits the emissive attribute for that quadrant

### Requirement: Emissive bake reports focused benchmark metrics
The client voxel benchmark SHALL expose enough worker-side metrics to distinguish overall decode cost from emissive grid construction, emissive bake work, and emissive output size.

#### Scenario: Benchmark sample includes emissive attributes
- **WHEN** the worker completes a benchmarked voxel decode with emissive attributes enabled
- **THEN** the benchmark sample includes emissive output bytes and phase metrics for grid construction and emissive baking when available

#### Scenario: Benchmark sample disables emissive attributes
- **WHEN** the worker completes a benchmarked voxel decode with emissive attributes disabled
- **THEN** the benchmark sample reports zero emissive output bytes and indicates that emissive bake phase work was skipped

### Requirement: Emissive candidate selection is allocation-conscious and deterministic
The client voxel worker SHALL select no more than the configured emitted-light
candidate limit for each lit vertex without constructing per-candidate object
and array chains in the hot path. The bounded selection SHALL preserve the
existing ordering semantics of squared distance followed by emitter index.

#### Scenario: Vertex has more candidates than the configured limit
- **WHEN** a lit vertex has more reachable emitter candidates than `maxCandidatesPerVertex`
- **THEN** the worker evaluates only the nearest bounded set ordered by squared distance and then emitter index

#### Scenario: Vertex has equal-distance candidates
- **WHEN** two reachable candidates have equal squared distance from a lit vertex
- **THEN** the worker selects the lower emitter index first

#### Scenario: Worker bakes an emitter-dense payload
- **WHEN** the worker bakes emissive attributes for a payload with many reachable emitters
- **THEN** it reuses candidate scratch storage and does not create mapped candidate objects, filtered arrays, sorted copies, and sliced copies for every lit vertex

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
