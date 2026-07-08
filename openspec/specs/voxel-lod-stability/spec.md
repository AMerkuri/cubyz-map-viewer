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
The client SHALL preserve stationary voxel LOD convergence while keeping loaded voxel LOD detail within the configured render-distance, debug-setting, and memory-budget constraints for a stable camera pose. Tile effective distance SHALL be computed using 3D distance (including the Z axis) relative to actual loaded tile bounds when available, falling back to reference surface Z for unloaded candidates, and scaled by a screen-space distance modifier that accounts for camera FOV and viewport size. Focus-adjacent loaded tiles that occupy significant screen space SHALL be eligible for finer LOD than global reference-surface distance alone would select.

#### Scenario: Stationary regression camera has bounded LOD1 residency
- **WHEN** the viewer is stationary at a detailed voxel view after all pending voxel fetch and mesh work has completed
- **THEN** repeated LOD update passes MUST keep the loaded voxel tile set stable
- **THEN** the selected LOD1 regions MUST remain explainable by the active render distance, LOD thresholds, loaded tile bounds, focus bias, behind-camera bias, memory/detail budget, and screen-space distance scale

#### Scenario: High-altitude camera selects coarser LOD
- **WHEN** the camera is positioned at a high altitude above the terrain surface (e.g., camera Z = 3500, terrain Z ≈ 35)
- **THEN** tiles directly below the camera MUST NOT be selected at LOD1 if their 3D effective distance exceeds the LOD1 threshold
- **THEN** the selected LOD for those tiles MUST correspond to the 3D distance from the camera to the reference surface Z

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

### Requirement: Debug stats support LOD performance comparison
The debug HUD SHALL expose enough stable counters to compare voxel LOD residency and memory behavior between application versions at the same camera URL.

#### Scenario: Comparing master with a prior release
- **WHEN** the same camera URL is loaded in two application versions and voxel loading reaches idle
- **THEN** the HUD MUST show loaded voxel counts by LOD, estimated memory by LOD, queued voxel work, warm-cache size, and voxel benchmark averages in a form suitable for side-by-side comparison

### Requirement: Voxel loading comparisons use loading metrics rather than idle FPS
Voxel LOD and loading diagnostics SHALL provide stable counters for comparing voxel loading behavior at the same camera URL without treating idle FPS as the primary success metric.

#### Scenario: Regression camera reaches idle
- **WHEN** the regression camera URL reaches idle with no pending voxel fetch or mesh work
- **THEN** the comparison MUST include loaded counts by LOD, estimated memory by LOD, worker input bytes, decoded bytes, decode time, raw payload bytes, and queued worker-output bytes
- **THEN** idle FPS MUST NOT be treated as the primary pass/fail metric because the idle frame-rate cap can intentionally lower it

### Requirement: Optimized decode preserves stationary LOD convergence
The client SHALL preserve stationary voxel LOD convergence while changing voxel payload decode and worker output construction.

#### Scenario: Optimized payload is active at stable camera pose
- **WHEN** the viewer is stationary after all pending voxel fetch and mesh work has completed using the optimized payload format
- **THEN** repeated LOD update passes MUST keep the loaded voxel tile set stable
- **THEN** warm-cache restoration and stale refresh behavior MUST continue to dispose, restore, or replace optimized voxel tile resources according to existing cache and invalidation rules
