## ADDED Requirements

### Requirement: Greedy cube payload uses parametric geometry records
The voxel payload SHALL encode ordinary greedy full-cube quads using a compact parametric rectangle representation instead of explicit per-vertex fractional or fixed-point coordinates, while preserving explicit fractional vertex encoding for model and semantic geometry.

#### Scenario: Payload contains greedy cube quads
- **WHEN** the server encodes a voxel mesh containing axis-aligned greedy cube quads
- **THEN** those greedy cube quads MUST be represented by compact rectangle parameters sufficient to reconstruct the same world-space face boundaries
- **THEN** those greedy cube quads MUST NOT require four explicit XYZ vertices in the binary payload

#### Scenario: Payload contains fractional model geometry
- **WHEN** the server encodes a voxel mesh containing supported model or semantic quads with fractional or authored out-of-block coordinates
- **THEN** those quads MUST preserve sufficient coordinate precision to decode to the authored world-space geometry
- **THEN** cache validity MUST distinguish the payload format and model/semantic shape interpretation used to generate the mesh

### Requirement: Model geometry budget remains visible after greedy optimization
The voxel generation and service diagnostics SHALL continue to expose model/semantic geometry cost and budget pressure after the greedy cube payload format is optimized.

#### Scenario: Dense LOD1 model region is generated
- **WHEN** the server generates a LOD 1 voxel mesh whose model or semantic geometry reaches or exceeds the configured model-geometry budget
- **THEN** diagnostics MUST report emitted model quads, dropped model quads, model budget, total quads, and raw payload bytes
- **THEN** ordinary greedy cube quads MUST remain distinguishable from model or semantic quads in metrics
