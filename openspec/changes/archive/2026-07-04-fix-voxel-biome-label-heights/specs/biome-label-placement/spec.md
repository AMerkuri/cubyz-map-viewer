## ADDED Requirements

### Requirement: Biome labels use mode-appropriate height placement
The system SHALL place biome labels at heights that correspond to the active world-view mode rather than using a single shared global label plane.

#### Scenario: Terrain mode labels use visible terrain height
- **WHEN** biome labels are rendered in terrain mode for visible terrain tiles with different mesh elevations
- **THEN** the labels are placed using the corresponding visible terrain tile height plus label offset

#### Scenario: Voxel mode labels avoid camera-height-only placement
- **WHEN** biome labels are rendered in voxel mode and loaded voxel height data is available near their biome centroids
- **THEN** the labels are not all placed at the camera target height fallback

### Requirement: Voxel biome labels use local centroid height
The system SHALL resolve voxel-mode biome label height from local height data near each biome region centroid when such data is available.

#### Scenario: Labels in the same surface tile have different local heights
- **WHEN** multiple biome labels from the same surface tile have centroids over different loaded voxel top heights
- **THEN** each label is placed relative to its own local height instead of sharing one tile-level height

#### Scenario: Labels in the same voxel region do not use region maximum height for all centroids
- **WHEN** multiple biome labels fall inside the same loaded voxel region and only one part of that region contains a high peak
- **THEN** labels away from the peak are not raised to the peak's region-wide maximum height solely because they share the region

### Requirement: Voxel biome labels retain stable fallback behavior
The system SHALL keep biome labels visible with a deterministic fallback height when no local voxel height can be resolved for a label.

#### Scenario: Local voxel height is unavailable
- **WHEN** a voxel-mode biome label has no loaded voxel height data near its centroid
- **THEN** the label remains visible using a stable fallback height

#### Scenario: Voxel data loads after fallback placement
- **WHEN** a biome label was placed using fallback height and relevant voxel data later becomes loaded
- **THEN** the label height is recomputed using the newly available local height data
