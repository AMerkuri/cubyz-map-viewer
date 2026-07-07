## ADDED Requirements

### Requirement: Stable voxel LOD selection respects detail budget
The client SHALL preserve stationary voxel LOD convergence while keeping loaded LOD1 detail within the configured render-distance, debug-setting, and memory-budget constraints for a stable camera pose.

#### Scenario: Stationary regression camera has bounded LOD1 residency
- **WHEN** the viewer is stationary at a detailed voxel view after all pending voxel fetch and mesh work has completed
- **THEN** repeated LOD update passes MUST keep the loaded voxel tile set stable
- **THEN** the selected LOD1 regions MUST remain explainable by the active render distance, LOD thresholds, behind-camera bias, and memory/detail budget

#### Scenario: LOD selection considers vertical cost without oscillation
- **WHEN** terrain height or loaded voxel bounds make a region vertically distant from the camera
- **THEN** LOD selection MUST avoid retaining unnecessary high-detail LOD1 geometry for that region when doing so does not create visible coverage holes
- **THEN** the selection MUST continue to converge rather than oscillating between parent and child tiles

### Requirement: Debug stats support LOD performance comparison
The debug HUD SHALL expose enough stable counters to compare voxel LOD residency and memory behavior between application versions at the same camera URL.

#### Scenario: Comparing master with a prior release
- **WHEN** the same camera URL is loaded in two application versions and voxel loading reaches idle
- **THEN** the HUD MUST show loaded voxel counts by LOD, estimated memory by LOD, queued voxel work, warm-cache size, and voxel benchmark averages in a form suitable for side-by-side comparison
