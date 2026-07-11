## Purpose

Define capped LOD1 halo retention and production-worker validation needed to preserve visible emitted-light continuity across region seams.

## Requirements

### Requirement: Capped LOD1 halo payloads preserve visible seam sources
When an LOD1 voxel payload exceeds the emitter-record cap, the server SHALL retain neighboring halo emitters whose configured influence radius reaches visible opaque receiving geometry at a horizontal region boundary. Retention SHALL be deterministic and bounded, and SHALL not depend on the browser load order of the neighboring region.

#### Scenario: Dense halo candidates include a source near visible boundary geometry
- **WHEN** multiple halo candidates compete for a capped horizontal edge and one candidate can illuminate a visible receiving boundary vertex
- **THEN** the capped payload retains that candidate before unrelated candidates that cannot illuminate the same visible boundary geometry

#### Scenario: Both sides of a dense LOD1 seam are generated
- **WHEN** adjacent LOD1 regions each generate capped payloads for geometry sharing a boundary vertex
- **THEN** each payload retains the halo sources needed to produce equivalent bounded emitted-light contribution at that vertex, apart from geometry, material, or open-face differences

#### Scenario: Neighbor region is not browser-loaded
- **WHEN** the server generates a capped LOD1 payload before the browser requests or loads its neighboring region
- **THEN** the payload already contains retained boundary-relevant halo sources and does not require a client neighbor-load refresh to correct its local light

### Requirement: Capped seam continuity is validated through the production worker
The voxel seam validation workflow SHALL exercise the production browser mesh worker with generated capped LOD1 payloads and compare normalized emissive attributes at matching physical seam vertices.

#### Scenario: Capped fixture omits spatially important records under the previous ordering
- **WHEN** the validation fixture creates dense halo candidates with multiple Y/Z locations at the same region-edge distance
- **THEN** the validator confirms that every source needed by the matched seam vertices is retained and that their worker-baked emissive values remain within the configured encoded-attribute tolerance

#### Scenario: Uncapped fixture is generated
- **WHEN** the validator generates a seam payload below the emitter-record cap
- **THEN** it confirms unchanged deterministic record ordering and continuous worker-baked seam values
