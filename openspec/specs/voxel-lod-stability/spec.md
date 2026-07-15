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
The client SHALL preserve visible voxel coverage while stabilizing loaded voxel residency. LOD transitions SHALL retain eligible loaded coverage until replacement coverage is present in the loaded scene state.

#### Scenario: Parent and child coverage remain continuous
- **WHEN** finer voxel children are available, missing, or still being refined under a loaded parent region
- **THEN** the selected loaded tiles MUST provide continuous visible coverage without introducing holes from the stabilization logic

#### Scenario: Missing regions still use fallback coverage
- **WHEN** a requested finer voxel region is unavailable or marked missing
- **THEN** the client MUST continue using an eligible loaded coarser fallback region when one is available

#### Scenario: Zoom-out waits for coarse scene readiness
- **WHEN** zoom-out or view-driven coarsening selects an unloaded coarse ancestor whose finer descendants currently provide loaded visible coverage
- **THEN** the client MUST keep eligible loaded descendants visible while requesting the coarse ancestor
- **THEN** queued, fetching, worker, expanded-output, or warm-cached state for the ancestor MUST NOT by itself retire the descendant coverage

#### Scenario: Scene-ready coarse tile replaces fine fallback
- **WHEN** the requested coarse ancestor has been inserted into the loaded scene state
- **THEN** the client MUST make the coarse ancestor visible and stop retaining its fine descendants as transition fallback
- **THEN** the normal unload grace and warm-cache policy MAY retire those descendants

#### Scenario: Descendant fallback does not request obsolete detail
- **WHEN** loaded fine descendants are retained only to cover an unloaded desired coarse ancestor
- **THEN** fallback discovery MUST NOT request missing fine descendants or preserve obsolete fine fetch and mesh work solely to complete that fallback

### Requirement: Stability respects invalidation and memory controls
The client SHALL keep existing invalidation and cache-limit behavior effective while preventing stationary oscillation.

#### Scenario: Stale voxel refresh can replace retained tiles
- **WHEN** a voxel tile is marked stale by a terrain update or refresh path
- **THEN** the client MUST allow the stale tile to be refreshed or replaced even if the camera is stationary

#### Scenario: Warm cache limit can evict cached resources
- **WHEN** the voxel warm cache exceeds its configured memory limit
- **THEN** the client MUST be able to evict warm cached voxel resources according to the existing cache limit behavior

### Requirement: Stable voxel LOD selection respects detail budget
The client SHALL preserve stationary voxel LOD convergence while keeping loaded voxel LOD detail within the configured render-distance, debug-setting, and memory-budget constraints for a stable camera pose. Tile effective distance SHALL be computed using 3D distance (including the Z axis) relative to actual loaded tile bounds when available, falling back to reference surface Z for unloaded candidates, and scaled by a screen-space distance modifier that accounts for camera FOV and viewport size. Focus-adjacent loaded tiles that occupy significant screen space SHALL be eligible for finer LOD than global reference-surface distance alone would select. Fine refinement SHALL additionally account for conservative camera-view relevance with angular hysteresis, while root eligibility and coarser fallback coverage remain governed by render distance.

#### Scenario: Stationary regression camera has bounded LOD1 residency
- **WHEN** the viewer is stationary at a detailed voxel view after all pending voxel fetch and mesh work has completed
- **THEN** repeated LOD update passes MUST keep the loaded voxel tile set stable
- **THEN** the selected LOD1 regions MUST remain explainable by the active render distance, LOD thresholds, loaded tile bounds, focus bias, camera-view relevance, memory/detail budget, and screen-space distance scale

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
- **THEN** that tile and necessary immediate coverage around it MUST remain eligible for local fine refinement regardless of peripheral or rear view classification
- **THEN** the focus bias MUST remain local and MUST NOT force unrelated distant tiles to LOD1

#### Scenario: Reference FOV and viewport are neutral
- **WHEN** the camera FOV equals the configured reference FOV and the viewport height equals the configured reference viewport height
- **THEN** the screen-space distance scale MUST evaluate to approximately 1.0
- **THEN** LOD selection MUST not receive additional FOV or viewport distance scaling

#### Scenario: Narrower FOV selects finer LOD at same distance
- **WHEN** the camera FOV is narrower than the reference FOV (e.g., 40° vs 60°) and the camera is at the same 3D position
- **THEN** the screen-space distance scale MUST be less than 1.0
- **THEN** forward-visible tiles MAY be selected at a finer LOD than they would be at the reference FOV because they appear larger on screen

#### Scenario: Larger viewport selects finer LOD at same distance
- **WHEN** the viewport height is larger than the reference viewport height (e.g., 2160px vs 1080px) and the camera is at the same 3D position
- **THEN** the screen-space distance scale MUST be less than 1.0
- **THEN** forward-visible tiles MAY be selected at a finer LOD than they would be at the reference viewport because tiles occupy more pixels

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

### Requirement: Voxel LOD transitions preserve emitted-light cues
The viewer SHALL preserve the perceived brightness, dominant color, and visible influence footprint of important emitted-light areas across voxel LOD transitions so strong or clustered LOD 1 sources do not progressively dim, shrink, or disappear solely because the selected voxel geometry changed to a coarser LOD. Preservation SHALL use bounded LOD 1-derived representatives and remain constrained by payload, server summary-generation, client emissive-bake, and runtime accent budgets.

#### Scenario: Lit area transitions from LOD 1 to coarser LOD
- **WHEN** a visible area containing strong or clustered LOD 1 emitters transitions to LOD 2, 4, 8, 16, or 32 voxel geometry
- **THEN** representative emitted-light records preserve a recognizable dominant hue and bounded light cue for that area
- **THEN** the cue does not exhibit systematic brightness or footprint loss at each successive LOD solely because fewer same-LOD emitting blocks survived voxel reduction

#### Scenario: Source disappears from coarse voxel data
- **WHEN** an important emitting block is present in LOD 1 source data but absent from the selected coarser voxel chunks
- **THEN** its LOD 1-derived cluster remains eligible to contribute to a coarse representative

#### Scenario: Dense cluster transitions to coarser LOD
- **WHEN** multiple nearby LOD 1 emitters are represented by fewer coarse records
- **THEN** representative power and influence footprint reflect the cluster rather than making each representative equivalent to one LOD 1 emitter
- **THEN** configured compression and clamping prevent the cluster from becoming an oversized saturated light patch

#### Scenario: Coarser LOD is budget constrained
- **WHEN** a coarser LOD region contains more source clusters than the aggregation or runtime budget allows
- **THEN** the viewer prioritizes stronger and more spatially significant light cues without requiring every fine emitter to remain individually visible

#### Scenario: Coarser LOD aggregation is performance constrained
- **WHEN** LOD 1 source summaries or coarse representative records would exceed configured generation, payload, or client emissive-bake budgets
- **THEN** the system reduces summary or representative detail deterministically while preserving the strongest bounded cues

#### Scenario: Representative transition scene is visually validated
- **WHEN** the same nighttime scene and camera are captured at each supported voxel LOD
- **THEN** documented brightness and footprint acceptance bands compare each important lit area against its LOD 1 baseline
- **THEN** validation rejects progressive dimming as well as excessive coarse-LOD overbrightening or footprint growth

#### Scenario: Emissive diagnostics are available
- **WHEN** an LOD transition scene is benchmarked with LOD 1-derived coarse representatives
- **THEN** diagnostics expose source-summary work, representative count, encoded power and footprint ranges, emitter bytes, emissive grid time, emissive bake time, and evaluated or culled quad data sufficient to verify the transition remains within defined budgets

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
