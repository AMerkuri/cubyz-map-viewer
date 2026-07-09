## MODIFIED Requirements

### Requirement: Viewer renders bounded block-emissive lighting
The viewer SHALL render block-emissive lighting as a bounded Cubyz-like local illumination approximation where emitted blocks affect nearby voxel surfaces through baked or mesh-local light contribution, while dynamic point lights and glow sprites remain optional accents rather than the primary lighting model.

#### Scenario: Nighttime scene contains emitting blocks
- **WHEN** the active atmosphere is in a low-light state and loaded LOD 1 regions contain emitter records
- **THEN** emitting blocks remain visibly self-lit or glow-tinted and nearby terrain or voxel surfaces receive local emitted-light color that is integrated into their rendered face colors or equivalent mesh-local lighting

#### Scenario: Multiple emitters illuminate nearby surfaces
- **WHEN** nearby loaded LOD 1 emitters contribute to the same visible voxel surface
- **THEN** the viewer combines their bounded local-light contributions without requiring an unbounded number of Three.js point lights

#### Scenario: Loaded emitters exceed rendering budget
- **WHEN** the number of loaded emitter records exceeds the active block-light rendering budget
- **THEN** the viewer preserves bounded local surface illumination for loaded voxel geometry and limits only optional runtime accents such as point lights, glow sprites, or other nonessential effects to preserve scene responsiveness

#### Scenario: Block-emissive lighting is disabled or unavailable
- **WHEN** block-emissive lighting is disabled by quality settings or unsupported by the decoded payload
- **THEN** voxel rendering continues using existing atmosphere, vertex colors, AO, and scene lighting without failing

### Requirement: Emitter metadata participates in voxel cache validity
Voxel mesh cache keys SHALL distinguish emitted-light metadata and emitted-light rendering semantics so stale geometry-only, stale-color, stale-emitter, or stale-local-light payloads are not reused after emitter-relevant changes.

#### Scenario: Emitted-light metadata changes
- **WHEN** layered block assets change the `.emittedLight` value for a palette entry
- **THEN** generated voxel payloads and any derived local-light presentation reflect the current emitted-light color rather than a stale cached value

#### Scenario: Emitter payload format changes
- **WHEN** the binary emitter record layout or interpretation changes
- **THEN** previously persisted voxel mesh cache entries generated with the old layout are not reused

#### Scenario: Local-light rendering semantics change
- **WHEN** server-generated or client-decoded voxel payload semantics change for baked or mesh-local emitted-light contribution
- **THEN** previously persisted voxel mesh cache entries generated with the old lighting semantics are not reused
