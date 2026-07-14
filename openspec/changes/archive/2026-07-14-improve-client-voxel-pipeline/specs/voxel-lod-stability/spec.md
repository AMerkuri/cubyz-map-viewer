## MODIFIED Requirements

### Requirement: Stable voxel LOD selection respects detail budget
The client SHALL preserve stationary voxel LOD convergence while keeping loaded voxel LOD detail within the configured render-distance, debug-setting, and memory-budget constraints for a stable camera pose. Tile effective distance SHALL be computed using 3D distance (including the Z axis) relative to actual loaded tile bounds when available, falling back to reference surface Z for unloaded candidates, and scaled by a screen-space distance modifier that accounts for camera FOV and viewport size. Focus-adjacent loaded tiles that occupy significant screen space SHALL be eligible for finer LOD than global reference-surface distance alone would select. Fine refinement SHALL additionally account for conservative camera-view relevance with angular hysteresis, while root eligibility and coarser fallback coverage remain governed by render distance.

#### Scenario: Stationary regression camera has bounded LOD1 residency
- **WHEN** the viewer is stationary at a detailed voxel view after all pending voxel fetch and mesh work has completed
- **THEN** repeated LOD update passes MUST keep the loaded voxel tile set stable
- **THEN** the selected LOD1 regions MUST remain explainable by the active render distance, LOD thresholds, loaded tile bounds, focus bias, camera-view relevance, memory/detail budget, and screen-space distance scale

#### Scenario: High-altitude camera selects coarser LOD
- **WHEN** the camera is positioned at a high altitude above the terrain surface (e.g., camera Z = 3500, terrain Z approximately 35)
- **THEN** tiles directly below the camera MUST NOT be selected at LOD1 if their 3D effective distance exceeds the LOD1 threshold
- **THEN** the selected LOD for those tiles MUST correspond to the 3D distance from the camera to the reference surface Z

#### Scenario: High-altitude foreground geometry can refine
- **WHEN** the camera is at high altitude and loaded voxel geometry is directly in front of the camera/focus point at short camera distance
- **THEN** the client MUST evaluate that loaded tile using its actual bounds or projected screen size rather than only the low reference surface Z
- **THEN** the tile MAY refine to LOD1 if it occupies enough screen space under the active thresholds and debug settings
- **THEN** distant terrain below the camera MAY remain at coarser LODs

#### Scenario: Focus area biases finer LOD locally
- **WHEN** a resolved voxel focus point or raycast hit lies inside or near a loaded voxel tile
- **THEN** that tile and necessary immediate coverage around it MUST remain eligible for local fine refinement regardless of peripheral or rear view classification
- **THEN** the focus bias MUST remain local and MUST NOT force unrelated distant tiles to LOD1

#### Scenario: Reference FOV and viewport are neutral
- **WHEN** the camera FOV equals the configured reference FOV and the viewport height equals the configured reference viewport height
- **THEN** the screen-space distance scale MUST evaluate to approximately 1.0
- **THEN** LOD selection MUST not receive additional FOV or viewport distance scaling

#### Scenario: Narrower FOV selects finer LOD at same distance
- **WHEN** the camera FOV is narrower than the reference FOV (e.g., 40 degrees vs 60 degrees) and the camera is at the same 3D position
- **THEN** the screen-space distance scale MUST be less than 1.0
- **THEN** forward-visible tiles MAY be selected at a finer LOD than they would be at the reference FOV because they appear larger on screen

#### Scenario: Larger viewport selects finer LOD at same distance
- **WHEN** the viewport height is larger than the reference viewport height (e.g., 2160px vs 1080px) and the camera is at the same 3D position
- **THEN** the screen-space distance scale MUST be less than 1.0
- **THEN** forward-visible tiles MAY be selected at a finer LOD than they would be at the reference viewport because tiles occupy more pixels

#### Scenario: Smaller viewport selects coarser LOD at same distance
- **WHEN** the viewport height is smaller than the reference viewport height (e.g., 720px vs 1080px) and the camera is at the same 3D position
- **THEN** the screen-space distance scale MUST be greater than 1.0
- **THEN** tiles MAY be selected at a coarser LOD than they would be at the reference viewport because tiles occupy fewer pixels

#### Scenario: Ground-level camera is unaffected by Z distance
- **WHEN** the camera is at or near the terrain surface level (camera Z approximately equals surface Z)
- **THEN** tile distance selection MUST behave identically to the previous horizontal-only distance calculation because the Z component approaches zero

#### Scenario: LOD selection considers vertical cost without oscillation
- **WHEN** terrain height or loaded voxel bounds make a region vertically distant from the camera
- **THEN** LOD selection MUST avoid retaining unnecessary high-detail LOD1 geometry for that region when doing so does not create visible coverage holes
- **THEN** the selection MUST continue to converge rather than oscillating between parent and child tiles

#### Scenario: Forward tile receives normal refinement
- **WHEN** a tile's conservative bounds intersect the expanded forward camera detail region and it is within active distance and projected-size thresholds
- **THEN** camera-view relevance MUST NOT force that tile to a coarser LOD than the existing distance, screen-space, and focus rules select

#### Scenario: Peripheral tile uses reduced refinement
- **WHEN** a non-focus tile lies in the peripheral view region outside the forward detail region
- **THEN** its selected detail MUST be limited to at least one supported LOD level coarser than the otherwise desired LOD
- **THEN** an eligible coarser ancestor MUST continue to provide coverage while residency transitions

#### Scenario: Rear tile uses coarse refinement
- **WHEN** a non-focus tile lies clearly outside the camera's expanded view region
- **THEN** its selected detail MUST be limited to at least two supported LOD levels coarser than the otherwise desired LOD
- **THEN** the tile MUST remain eligible for render-distance fallback coverage rather than being hard-culled from selection

#### Scenario: Camera rotates across a view boundary
- **WHEN** a tile moves between forward, peripheral, and rear classification because the camera rotates near a classification boundary
- **THEN** separate enter and exit margins MUST prevent alternating refinement decisions for an otherwise stable camera pose
- **THEN** detail debounce, unload grace, and warm-cache restoration MUST remain effective
