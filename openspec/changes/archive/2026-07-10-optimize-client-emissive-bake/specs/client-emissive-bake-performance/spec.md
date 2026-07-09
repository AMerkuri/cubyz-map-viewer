## ADDED Requirements

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
