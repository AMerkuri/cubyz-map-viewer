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
The client voxel benchmark SHALL expose enough worker-side metrics to distinguish overall decode cost from emissive grid construction, candidate-neighborhood discovery, emissive contribution evaluation, emissive bake work, cache storage, and emissive output size. Progressive enhancement results SHALL report these emissive metrics rather than leaving the benchmark population with base-phase zero values only.

#### Scenario: Benchmark sample includes emissive attributes
- **WHEN** the worker completes a benchmarked one-phase voxel decode or progressive enhancement with emissive attributes enabled
- **THEN** the benchmark sample includes emissive output bytes and phase metrics for grid construction and emissive baking when available
- **THEN** it includes receiver vertices, neighborhood cell probes, non-empty buckets, raw bucket entries, deduplicated candidate entries, cache hits, cache misses, cache entries, and peak cache bytes when candidate discovery runs

#### Scenario: Benchmark sample disables emissive attributes
- **WHEN** the worker completes a benchmarked voxel decode with emissive attributes disabled
- **THEN** the benchmark sample reports zero emissive output bytes and indicates that emissive grid, candidate-discovery, and bake phase work was skipped

#### Scenario: Progressive enhancement is benchmarked
- **WHEN** progressive base decoding defers emissive baking to a separate enhancement job
- **THEN** the enhancement result MUST contribute its worker duration, emissive phase metrics, output bytes, and candidate-cache metrics to enhancement-specific benchmark diagnostics
- **THEN** base-phase zero-valued emissive metrics MUST NOT be presented as the complete emissive workload

### Requirement: Emissive baking reuses deterministic receiver-cell neighborhoods
The client voxel worker SHALL be able to cache the deduplicated emitter-index union discovered from the fixed neighboring-cell footprint for a receiver grid cell and reuse that immutable union for later vertices in the same receiver cell. Reuse SHALL preserve payload emitter order and SHALL leave per-vertex radius rejection, open-face transmission, squared-distance ordering, candidate limits, falloff, and output encoding unchanged.

#### Scenario: Multiple vertices occupy one receiver cell
- **WHEN** emissive baking evaluates multiple vertices whose positions map to the same emitter-grid receiver cell
- **THEN** the worker MUST discover and deduplicate that receiver cell's fixed neighborhood at most once while the cache entry remains retained
- **THEN** every vertex MUST still perform its own exact eligibility and light-contribution evaluation against the reused candidate union

#### Scenario: Vertices occupy different receiver cells
- **WHEN** emissive baking evaluates vertices mapped to different receiver cells
- **THEN** each receiver cell MUST use the candidate union derived from its own complete fixed neighborhood
- **THEN** candidate records from one receiver cell MUST NOT be substituted for another cell

#### Scenario: Cached neighborhood reaches its memory bound
- **WHEN** retaining another receiver-cell candidate union would exceed the configured per-job cache bound
- **THEN** the worker MUST preserve correct deterministic lighting by using the uncached neighborhood-discovery path for that receiver cell or by evicting only entries that can be reconstructed identically
- **THEN** the worker MUST NOT fail the mesh job or omit eligible emitters solely because the cache is full

### Requirement: Cached candidate discovery proves parity and bounded benefit
The cached receiver-cell path SHALL retain the current uncached 27-cell search as a benchmark and test baseline until representative evidence demonstrates byte-identical compact emissive output, seam parity, lower worker bake time, and bounded cache memory. The cached path MUST NOT become the production default unless repeated serial comparisons show at least a 25 percent reduction in aggregate emissive bake time and at least a twofold reduction in neighborhood cell probes across the representative emitter-bearing fixture set, without a greater than 10 percent bake-time regression on any stable fixture and with no more than 16 MiB peak additional cache storage per worker job.

#### Scenario: Cached and uncached paths process the same payload
- **WHEN** both paths bake a representative sparse, dense, halo-bearing, coarse-LOD, or seam payload
- **THEN** they MUST emit byte-identical normalized emissive arrays for every quadrant
- **THEN** emitter records, geometry arrays, and non-emissive metadata MUST remain semantically identical

#### Scenario: Representative comparison meets the decision gate
- **WHEN** repeated serial cached-versus-uncached comparisons meet the required aggregate time, per-fixture regression, cell-probe, memory, and parity criteria
- **THEN** the cached receiver-cell path MAY replace the uncached path as the production default
- **THEN** the comparison evidence MUST record fixture identity, LOD, emitter mix, timings, cache effectiveness, probe counts, and peak cache bytes

#### Scenario: Representative comparison fails the decision gate
- **WHEN** caching fails any required performance, memory, or parity criterion
- **THEN** the uncached deterministic search MUST remain the production default
- **THEN** the failed criterion and measured result MUST remain documented for follow-up analysis

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
The client worker pipeline SHALL support a base phase that produces complete renderable voxel geometry without waiting for mesh-local emissive attribute baking. When emissive enhancement is enabled and applicable, it SHALL remain independently schedulable after the base result but SHALL NOT consume base-reserved fetch, compact-input, worker, or scene capacity while executable base work remains anywhere in the protected loading lifecycle. A current enhancement SHALL remain eligible after its base geometry becomes fresh and leaves fetch-request demand while its loaded-base target remains valid.

#### Scenario: Payload contains expensive emissive work
- **WHEN** a demanded voxel payload contains geometry and emitter records requiring mesh-local emissive baking
- **THEN** the worker MUST be able to return complete base geometry before emissive attributes are calculated
- **THEN** the client MUST be able to insert and select that base geometry visible while enhancement remains pending

#### Scenario: Fresh base leaves fetch demand before enhancement completes
- **WHEN** a progressive base tile is inserted and the next LOD reconciliation removes its fresh key from fetch-request demand
- **THEN** the client MUST retain or continue the enhancement while the same loaded base tile, refresh version, and base mesh identity remain current
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
