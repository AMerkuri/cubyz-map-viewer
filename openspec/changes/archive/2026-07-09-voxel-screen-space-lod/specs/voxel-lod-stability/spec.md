## MODIFIED Requirements

### Requirement: Stable voxel LOD selection respects detail budget
The client SHALL preserve stationary voxel LOD convergence while keeping loaded voxel LOD detail within the configured render-distance, debug-setting, and memory-budget constraints for a stable camera pose. Tile effective distance SHALL be computed using 3D distance (including the Z axis) relative to actual loaded tile bounds when available, falling back to reference surface Z for unloaded candidates, and scaled by a screen-space distance modifier that accounts for camera FOV and viewport size. Focus-adjacent loaded tiles that occupy significant screen space SHALL be eligible for finer LOD than global reference-surface distance alone would select.

#### Scenario: Stationary regression camera has bounded LOD1 residency
- **WHEN** the viewer is stationary at a detailed voxel view after all pending voxel fetch and mesh work has completed
- **THEN** repeated LOD update passes MUST keep the loaded voxel tile set stable
- **THEN** the selected LOD1 regions MUST remain explainable by the active render distance, LOD thresholds, loaded tile bounds, focus bias, behind-camera bias, memory/detail budget, and screen-space distance scale

#### Scenario: High-altitude foreground geometry can refine
- **WHEN** the camera is at high altitude and loaded voxel geometry is directly in front of the camera/focus point at short camera distance
- **THEN** the client MUST evaluate that loaded tile using its actual bounds or projected screen size rather than only the low reference surface Z
- **THEN** the tile MAY refine to LOD1 if it occupies enough screen space under the active thresholds and debug settings
- **THEN** distant terrain below the camera MAY remain at coarser LODs

#### Scenario: Focus area biases finer LOD locally
- **WHEN** a resolved voxel focus point or raycast hit lies inside or near a loaded voxel tile
- **THEN** that tile and necessary immediate coverage around it SHOULD be biased toward finer LOD selection
- **THEN** the focus bias MUST remain local and MUST NOT force unrelated distant tiles to LOD1

#### Scenario: Reference FOV and viewport are neutral
- **WHEN** the camera FOV equals the configured reference FOV and the viewport height equals the configured reference viewport height
- **THEN** the screen-space distance scale MUST evaluate to approximately 1.0
- **THEN** LOD selection MUST not receive additional FOV or viewport distance scaling

#### Scenario: Narrower FOV selects finer LOD at same distance
- **WHEN** the camera FOV is narrower than the reference FOV (e.g., 40° vs 60°) and the camera is at the same 3D position
- **THEN** the screen-space distance scale MUST be less than 1.0
- **THEN** tiles MAY be selected at a finer LOD than they would be at the reference FOV, because they appear larger on screen

#### Scenario: Larger viewport selects finer LOD at same distance
- **WHEN** the viewport height is larger than the reference viewport height (e.g., 2160px vs 1080px) and the camera is at the same 3D position
- **THEN** the screen-space distance scale MUST be less than 1.0
- **THEN** tiles MAY be selected at a finer LOD than they would be at the reference viewport, because tiles occupy more pixels

#### Scenario: Smaller viewport selects coarser LOD at same distance
- **WHEN** the viewport height is smaller than the reference viewport height (e.g., 720px vs 1080px) and the camera is at the same 3D position
- **THEN** the screen-space distance scale MUST be greater than 1.0
- **THEN** tiles MAY be selected at a coarser LOD than they would be at the reference viewport, because tiles occupy fewer pixels

#### Scenario: LOD selection considers vertical cost without oscillation
- **WHEN** terrain height or loaded voxel bounds make a region vertically distant from the camera
- **THEN** LOD selection MUST avoid retaining unnecessary high-detail LOD1 geometry for that region when doing so does not create visible coverage holes
- **THEN** the selection MUST continue to converge rather than oscillating between parent and child tiles
