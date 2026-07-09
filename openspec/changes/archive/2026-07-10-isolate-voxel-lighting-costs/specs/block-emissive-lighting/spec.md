## MODIFIED Requirements

### Requirement: Viewer renders bounded block-emissive lighting
The viewer SHALL render block-emissive lighting as a bounded Cubyz-like local illumination approximation where emitted blocks affect nearby voxel surfaces through baked or mesh-local light contribution, while dynamic point lights and glow sprites remain optional accents rather than the primary lighting model. Debug-only voxel-lighting performance diagnostics MAY disable halo emitter contribution or mesh-local emissive attributes for measurement, but those diagnostics MUST NOT change the default emitted-light presentation.

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

#### Scenario: Performance diagnostic disables mesh-local inputs
- **WHEN** debug-only voxel-lighting performance diagnostics disable halo emitter contribution, mesh-local emissive attributes, or both
- **THEN** voxel rendering continues without failing and the default block-emissive lighting behavior is restored when the diagnostic setting is cleared
