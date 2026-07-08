## MODIFIED Requirements

### Requirement: Stable voxel LOD selection respects detail budget
The client SHALL preserve stationary voxel LOD convergence while keeping loaded voxel LOD detail within the configured render-distance, debug-setting, and memory-budget constraints for a stable camera pose. Tile effective distance SHALL be computed using 3D distance (including the Z axis) relative to a reference surface Z, not horizontal-only distance.

#### Scenario: Stationary regression camera has bounded LOD1 residency
- **WHEN** the viewer is stationary at a detailed voxel view after all pending voxel fetch and mesh work has completed
- **THEN** repeated LOD update passes MUST keep the loaded voxel tile set stable
- **THEN** the selected LOD1 regions MUST remain explainable by the active render distance, LOD thresholds, behind-camera bias, and memory/detail budget

#### Scenario: High-altitude camera selects coarser LOD
- **WHEN** the camera is positioned at a high altitude above the terrain surface (e.g., camera Z = 3500, terrain Z ≈ 35)
- **THEN** tiles directly below the camera MUST NOT be selected at LOD1 if their 3D effective distance exceeds the LOD1 threshold
- **THEN** the selected LOD for those tiles MUST correspond to the 3D distance from the camera to the reference surface Z

#### Scenario: Ground-level camera is unaffected by Z distance
- **WHEN** the camera is at or near the terrain surface level (camera Z ≈ surface Z)
- **THEN** tile LOD selection MUST behave identically to the previous horizontal-only distance calculation, because the Z component approaches zero

#### Scenario: LOD selection considers vertical cost without oscillation
- **WHEN** terrain height or loaded voxel bounds make a region vertically distant from the camera
- **THEN** LOD selection MUST avoid retaining unnecessary high-detail LOD1 geometry for that region when doing so does not create visible coverage holes
- **THEN** the selection MUST continue to converge rather than oscillating between parent and child tiles

### Requirement: Voxel focus initialization uses 3D distance
The client SHALL initialize the voxel focus zoom distance from 3D distance (camera Z minus reference surface Z) when no loaded tiles or raycast hits are available, instead of using the orbit zoom distance which can be arbitrarily small.

#### Scenario: Page load at high altitude
- **WHEN** the viewer loads a deep-link URL with a high camera Z (e.g., z=3500) and no voxel tiles are loaded yet
- **THEN** the initial focus LOD MUST be computed from the 3D distance to the reference surface Z, not the orbit zoom distance
- **THEN** the initial focus LOD MUST NOT be LOD1 when the 3D distance exceeds the LOD1 threshold

#### Scenario: Page load at ground level
- **WHEN** the viewer loads at ground level (camera Z ≈ surface Z) and no tiles are loaded
- **THEN** the initial focus zoom distance MUST be approximately the orbit zoom distance, since the 3D distance and orbit distance converge when the camera is near the surface
