## Purpose

Defines stability expectations for client-side voxel LOD selection, loaded voxel residency, and warm-cache restoration while the camera and world state are stationary.

## Requirements

### Requirement: Stationary voxel LOD selection converges
The client SHALL converge to a stable loaded voxel tile set when the camera pose, controls target, world data, debug settings, and voxel index remain unchanged.

#### Scenario: Stationary detailed view has stable loaded count
- **WHEN** the viewer is standing still at a detailed voxel view after all pending voxel fetch and mesh work has completed
- **THEN** repeated LOD update passes MUST NOT alternate the loaded voxel count between two recurring values

#### Scenario: Warm cache does not repeatedly exchange the same tiles
- **WHEN** no camera motion, world update, stale voxel refresh, or debug setting change has occurred
- **THEN** the same voxel tiles MUST NOT repeatedly move from loaded state to warm cache and back on consecutive LOD update cycles

### Requirement: Stable selection preserves voxel coverage
The client SHALL preserve visible voxel coverage while stabilizing loaded voxel residency.

#### Scenario: Parent and child coverage remain continuous
- **WHEN** finer voxel children are available, missing, or still being refined under a loaded parent region
- **THEN** the selected loaded tiles MUST provide continuous visible coverage without introducing holes from the stabilization logic

#### Scenario: Missing regions still use fallback coverage
- **WHEN** a requested finer voxel region is unavailable or marked missing
- **THEN** the client MUST continue using an eligible loaded coarser fallback region when one is available

### Requirement: Stability respects invalidation and memory controls
The client SHALL keep existing invalidation and cache-limit behavior effective while preventing stationary oscillation.

#### Scenario: Stale voxel refresh can replace retained tiles
- **WHEN** a voxel tile is marked stale by a terrain update or refresh path
- **THEN** the client MUST allow the stale tile to be refreshed or replaced even if the camera is stationary

#### Scenario: Warm cache limit can evict cached resources
- **WHEN** the voxel warm cache exceeds its configured memory limit
- **THEN** the client MUST be able to evict warm cached voxel resources according to the existing cache limit behavior

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
