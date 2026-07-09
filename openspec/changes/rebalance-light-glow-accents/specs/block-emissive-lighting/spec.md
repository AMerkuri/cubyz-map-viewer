## ADDED Requirements

### Requirement: Runtime block-light accents preserve emitter color
Runtime block-light glow sprites and point-light accents SHALL remain secondary to mesh-local emitted-light illumination and SHALL preserve emitter color without introducing white-hot centers, hard white lines, or additive blowout that overpowers nearby voxel surfaces.

#### Scenario: Colored emitter source is highlighted
- **WHEN** a loaded emitting block receives a runtime source accent
- **THEN** the accent color remains visually derived from the emitter RGB color rather than a white sprite core

#### Scenario: Clustered emitters are visible
- **WHEN** several nearby emitters are active in a low-light scene
- **THEN** their runtime accents combine softly without producing hard white seams or lines that dominate the mesh-local light spread

#### Scenario: Lower quality settings are active
- **WHEN** block-light quality settings reduce runtime accent budgets
- **THEN** the viewer preserves mesh-local emitted-light illumination before optional point-light or glow-sprite accents
