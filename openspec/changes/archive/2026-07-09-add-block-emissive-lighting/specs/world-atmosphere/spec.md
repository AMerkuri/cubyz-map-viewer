## MODIFIED Requirements

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
