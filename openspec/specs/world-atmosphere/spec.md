## Purpose

Define the client-side atmosphere behavior for world-view lighting, sky presentation, and subtle depth effects.

## Requirements

### Requirement: Configurable Atmospheric Time Of Day
The viewer SHALL support a client-side atmospheric time-of-day state that controls visual lighting and sky presentation without changing server data or Cubyz world contracts.

#### Scenario: Time of day updates scene lighting
- **WHEN** the atmosphere time of day changes
- **THEN** the visible sun direction, light colors, and light intensities update to match that atmospheric time while terrain and voxel geometry remain unchanged

#### Scenario: Atmosphere remains client-local
- **WHEN** the viewer applies an atmosphere time of day
- **THEN** no server route payload, WebSocket event, voxel worker protocol, or Cubyz file parsing behavior is changed

### Requirement: Cubyz-Stylized Sky Rendering
The viewer SHALL render a stylized sky treatment that reflects the active atmospheric time of day and preserves the block-readable Cubyz visual style, including compatibility with available block-emissive lighting in low-light scenes.

#### Scenario: Sky reflects daytime state
- **WHEN** the active atmosphere state represents daytime
- **THEN** the sky presentation uses brighter daytime colors that keep terrain, voxels, labels, markers, and controls readable

#### Scenario: Sky reflects low-light state
- **WHEN** the active atmosphere state represents sunrise, sunset, or night
- **THEN** the sky presentation changes color and brightness without obscuring terrain silhouettes, voxel faces, labels, markers, controls, or available block-emissive lighting cues

#### Scenario: Low-light scene contains block emitters
- **WHEN** the active atmosphere state represents night and loaded voxel regions contain available block-emissive lighting metadata
- **THEN** the atmosphere preserves the usefulness of local emitter cues without requiring global ambient light to be raised to daytime readability

### Requirement: Subtle Terrain And Voxel Depth Enhancement
The viewer SHALL provide a subtle depth enhancement for terrain and voxels that improves shape separation without overpowering existing vertex colors, face shading, transparency, labels, or markers.

#### Scenario: Depth enhancement preserves readability
- **WHEN** depth enhancement is enabled in terrain or voxel view
- **THEN** concave areas, contact regions, or distant depth cues become more legible while block edges and material colors remain identifiable

#### Scenario: Transparent voxels remain usable
- **WHEN** transparent voxel rendering is visible with atmosphere depth enhancement active
- **THEN** transparent voxel faces remain distinguishable and do not become excessively dark or opaque because of the atmosphere effect

### Requirement: Optional Sun-Shaft Accent
The viewer SHALL support sun-shaft accents as an optional atmosphere effect that appears only when it improves the scene composition for low-angle sunlight.

#### Scenario: Sun shafts appear near low sun angles
- **WHEN** the active atmosphere state has a low-angle sun and sun-shaft accents are enabled
- **THEN** the viewer displays restrained stylized light shafts that align with the sun direction and do not block map inspection

#### Scenario: Sun shafts can be disabled or omitted
- **WHEN** sun-shaft accents are disabled or unsupported by the selected atmosphere quality path
- **THEN** the rest of the atmosphere system continues to render time-of-day lighting, sky presentation, and depth enhancement

### Requirement: Future Rendering Phases Remain Out Of Phase 1 Scope
The viewer SHALL treat water reflection/refraction, temporal anti-aliasing, cascaded shadow maps, PCSS shadows, and raymarched fly-through volumetric clouds as future rendering phases rather than required Phase 1 atmosphere behavior.

#### Scenario: Phase 1 atmosphere does not require advanced rendering phases
- **WHEN** the Phase 1 atmosphere capability is implemented
- **THEN** it can be considered complete without screen-space water reflection/refraction, temporal AA, cascaded shadow maps, PCSS contact-hardening shadows, or raymarched fly-through volumetric clouds

#### Scenario: Future phases can build on atmosphere state
- **WHEN** a later change adds an advanced rendering phase
- **THEN** it may reuse the atmosphere time-of-day and sun-direction state without changing the Phase 1 world-atmosphere requirements
