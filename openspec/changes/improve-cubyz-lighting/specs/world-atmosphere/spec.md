## MODIFIED Requirements

### Requirement: Cubyz-Stylized Sky Rendering
The viewer SHALL render a stylized sky treatment that reflects the active atmospheric time of day and preserves the block-readable Cubyz visual style, including compatibility with available block-emissive lighting in low-light scenes.

#### Scenario: Sky reflects daytime state
- **WHEN** the active atmosphere state represents daytime
- **THEN** the sky presentation uses brighter daytime colors that keep terrain, voxels, labels, markers, and controls readable

#### Scenario: Sky reflects low-light state
- **WHEN** the active atmosphere state represents sunrise, sunset, or night
- **THEN** the sky presentation changes color and brightness while preserving a low-intensity ambient or skylight floor so terrain silhouettes, vegetation, voxel faces, labels, markers, controls, and available block-emissive lighting cues remain readable

#### Scenario: Low-light scene contains block emitters
- **WHEN** the active atmosphere state represents night and loaded voxel regions contain available block-emissive lighting metadata
- **THEN** the atmosphere preserves local emitter contrast while avoiding near-black global crushing that makes non-emissive terrain and voxel context unreadable
