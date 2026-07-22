## ADDED Requirements

### Requirement: Emitter spatial cells retain exact three-dimensional identity
The client voxel worker MUST distinguish every supported emitter-grid cell by its complete X, Y, and Z coordinates in both dense and sparse storage modes. A storage optimization MUST NOT substitute, merge, or retrieve a bucket belonging to another coordinate because of numeric precision loss or key collision.

#### Scenario: Sparse buckets share horizontal coordinates
- **WHEN** a sparse emitter grid contains populated cells with equal X and Y coordinates and distinct Z coordinates
- **THEN** each lookup MUST return only the emitter indices inserted for the requested three-dimensional cell

#### Scenario: Sparse cells use realistic world offsets
- **WHEN** emitter coordinates map to supported positive or negative cell coordinates whose packed representation would exceed JavaScript's safe integer range
- **THEN** the worker MUST retain exact bucket identity without relying on an unsafe numeric integer

## MODIFIED Requirements

### Requirement: Emissive baking reuses deterministic receiver-cell neighborhoods
The client voxel worker SHALL be able to cache the deduplicated emitter-index union discovered from the fixed neighboring-cell footprint for a receiver grid cell and reuse that immutable union for later vertices in the same receiver cell. Receiver cache identity MUST preserve the complete X, Y, and Z cell coordinates without numeric precision loss. Reuse SHALL preserve payload emitter order and SHALL leave per-vertex radius rejection, open-face transmission, squared-distance ordering, candidate limits, falloff, and output encoding unchanged. When an exact bounded cache identity is unavailable, the worker MUST use deterministic uncached discovery or an equivalent collision-free fallback.

#### Scenario: Multiple vertices occupy one receiver cell
- **WHEN** emissive baking evaluates multiple vertices whose positions map to the same emitter-grid receiver cell
- **THEN** the worker MUST discover and deduplicate that receiver cell's fixed neighborhood at most once while the cache entry remains retained
- **THEN** every vertex MUST still perform its own exact eligibility and light-contribution evaluation against the reused candidate union

#### Scenario: Vertices occupy different receiver cells
- **WHEN** emissive baking evaluates vertices mapped to different receiver cells, including cells with equal X and Y coordinates and distinct Z coordinates
- **THEN** each receiver cell MUST use the candidate union derived from its own complete fixed neighborhood
- **THEN** candidate records from one receiver cell MUST NOT be substituted for another cell

#### Scenario: Receiver identity is outside the optimized cache domain
- **WHEN** a receiver cell cannot be represented by the optimized cache layout with an exact safe identity
- **THEN** the worker MUST use uncached neighborhood discovery or another collision-free representation
- **THEN** eligible emitter contributions MUST NOT be omitted because the optimized identity is unavailable

#### Scenario: Cached neighborhood reaches its memory bound
- **WHEN** retaining another receiver-cell candidate union would exceed the configured per-job cache bound
- **THEN** the worker MUST preserve correct deterministic lighting by using the uncached neighborhood-discovery path for that receiver cell or by evicting only entries that can be reconstructed identically
- **THEN** the worker MUST NOT fail the mesh job or omit eligible emitters solely because the cache is full

### Requirement: Cached candidate discovery proves parity and bounded benefit
The cached receiver-cell path SHALL retain the current uncached 27-cell search as a benchmark and test baseline until representative evidence demonstrates byte-identical compact emissive output, seam parity, lower worker bake time, and bounded cache memory. Representative evidence MUST include multiple vertical receiver cells at realistic non-origin and negative world coordinates. The cached path MUST NOT become the production default unless repeated serial comparisons show at least a 25 percent reduction in aggregate emissive bake time and at least a twofold reduction in neighborhood cell probes across the representative emitter-bearing fixture set, without a greater than 10 percent bake-time regression on any stable fixture and with no more than 16 MiB peak additional cache storage per worker job.

#### Scenario: Cached and uncached paths process the same payload
- **WHEN** both paths bake a representative sparse, dense, halo-bearing, coarse-LOD, seam, or multi-height non-origin payload
- **THEN** they MUST emit byte-identical normalized emissive arrays for every quadrant
- **THEN** emitter records, geometry arrays, and non-emissive metadata MUST remain semantically identical

#### Scenario: Representative comparison meets the decision gate
- **WHEN** repeated serial cached-versus-uncached comparisons meet the required aggregate time, per-fixture regression, cell-probe, memory, coordinate-identity, and parity criteria
- **THEN** the cached receiver-cell path MAY replace the uncached path as the production default
- **THEN** the comparison evidence MUST record fixture identity, coordinate range, LOD, emitter mix, timings, cache effectiveness, probe counts, and peak cache bytes

#### Scenario: Representative comparison fails the decision gate
- **WHEN** caching fails any required correctness, performance, memory, coordinate-identity, or parity criterion
- **THEN** the uncached deterministic search MUST remain the production default
- **THEN** the failed criterion and measured result MUST remain documented for follow-up analysis
