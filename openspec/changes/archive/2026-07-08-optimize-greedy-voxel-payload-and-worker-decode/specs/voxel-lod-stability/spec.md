## ADDED Requirements

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
