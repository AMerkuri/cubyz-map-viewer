## ADDED Requirements

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

## MODIFIED Requirements

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
