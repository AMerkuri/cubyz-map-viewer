## ADDED Requirements

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
