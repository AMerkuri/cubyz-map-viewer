## Purpose

Provide hermetic Node-based correctness coverage and opt-in benchmarks for the server and client voxel pipeline.

## Requirements

### Requirement: Hermetic voxel correctness suite
The project SHALL provide Node test-runner correctness coverage for server voxel generation and production client voxel mesh baking using generated temporary Cubyz world fixtures, without requiring a running application, browser, real save, or Cubyz asset installation.

#### Scenario: Run all voxel correctness tests
- **WHEN** a contributor runs the aggregate test command
- **THEN** the server, client, and server/client contract tests execute through Node's test runner
- **THEN** benchmark tests and the real-world voxel-lighting capture do not execute

#### Scenario: Run focused test groups
- **WHEN** a contributor selects the server or client test command
- **THEN** only the corresponding correctness group and its required shared helpers execute

### Requirement: Server voxel generation coverage
The server correctness suite SHALL verify deterministic voxel generation, emitter qualification, halo selection, cap behavior, coarse aggregation, and relevant generation statistics through production server services.

#### Scenario: Deterministic payload generation
- **WHEN** the same generated fixture and generation options are processed more than once
- **THEN** the emitted payload bytes and decoded emitter-record order are identical
- **THEN** no duplicate emitter records are present

#### Scenario: Boundary halo coverage with cap pressure
- **WHEN** adjacent LOD 1 fixtures contain required cross-boundary emitters with and without dense cap pressure
- **THEN** each generated payload retains the sources needed by receiving geometry across the shared boundary
- **THEN** the capped payload respects the production emitter-record cap

#### Scenario: Source qualification and coarse aggregation
- **WHEN** fixtures contain represented, hidden, depth-suppressed, model, and coarse-summary emitter sources
- **THEN** production generation includes only sources that qualify for the requested representation
- **THEN** a qualified detailed source remains available to illuminate coarse receiving geometry

#### Scenario: Structural performance invariants
- **WHEN** server fixtures exercise neighboring-region access and dense emitters
- **THEN** tests assert deterministic generator metrics that detect repeated parsing, unbounded record growth, or unexpected payload growth without relying on wall-clock duration

### Requirement: Production client emissive-bake coverage
The client correctness suite SHALL execute the production client voxel worker's exported mesh-building path under Node and verify its decoded emitter and emissive mesh output.

#### Scenario: Deterministic client mesh build
- **WHEN** the same voxel payload is built repeatedly by the production worker implementation
- **THEN** the decoded emitter records and mesh emissive attributes are identical

#### Scenario: Controlled emitter influence
- **WHEN** controlled payloads place emitters within, outside, or directionally restricted relative to receiving geometry
- **THEN** the generated emissive vertex values reflect the production radius and open-face transmission behavior

### Requirement: Adjacent seam color identity
The contract suite SHALL generate adjacent server payloads, process both through the production client voxel worker, and compare matching shared-boundary vertices by world position and normal.

#### Scenario: Uncapped LOD 1 seam
- **WHEN** adjacent LOD 1 regions are generated with cross-boundary emitters below cap pressure
- **THEN** the suite finds matching shared-boundary vertices
- **THEN** every normalized emissive color channel differs by no more than one compact encoding step

#### Scenario: Capped LOD 1 seam
- **WHEN** adjacent LOD 1 regions are generated with dense emitters and required same-edge-distance sources that differ by Y/Z locality
- **THEN** the required sources survive server cap selection on both sides
- **THEN** every matching seam vertex has emissive color equality within one compact encoding step

#### Scenario: Coarse LOD seam
- **WHEN** adjacent coarse-LOD regions use production summary emitter records
- **THEN** the suite finds matching shared-boundary vertices and their normalized emissive colors are equal within the active attribute's encoding tolerance

### Requirement: Opt-in voxel benchmarks
The project SHALL provide separately invoked server and client voxel benchmarks that use deterministic generated fixtures, warmup iterations, repeated serial measurements, and machine-readable or consistently structured summaries.

#### Scenario: Run server benchmarks
- **WHEN** a contributor invokes the server benchmark command
- **THEN** baseline generation, dense halo/cap pressure, adjacent-region access, and coarse-summary cases report sample count, minimum, median, p95, payload size, and available generator metrics

#### Scenario: Run client benchmarks
- **WHEN** a contributor invokes the client benchmark command
- **THEN** baseline payload decoding, dense emissive baking, and adjacent seam-pair cases report sample count, minimum, median, p95, output size, and available bake metrics

#### Scenario: Timing variability
- **WHEN** benchmark wall-clock results vary across machines or runs
- **THEN** timing results are reported for comparison but do not fail ordinary correctness verification against fixed millisecond thresholds

### Requirement: Contributor workflow migration
The project SHALL replace the standalone voxel seam validation entrypoint with documented Node test commands while preserving the separate real-world voxel-lighting validation harness unchanged.

#### Scenario: Verify voxel seams after migration
- **WHEN** a contributor needs to validate voxel seam behavior
- **THEN** documentation directs them to the server/client contract tests rather than `validate:voxel-seams`

#### Scenario: Perform visual lighting capture
- **WHEN** a contributor needs fixed-camera real-world lighting evidence
- **THEN** the existing `validate:voxel-lighting` command and its environment-dependent workflow remain available and unchanged
