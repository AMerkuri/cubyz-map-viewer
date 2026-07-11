## ADDED Requirements

### Requirement: Runtime block-light work follows rendered-frame scheduling
The world-view runtime SHALL reconcile loaded emitter regions and select runtime
block-light accents only on frames that pass the configured active or idle frame
cap. It SHALL reconcile loaded regions when their contents change, including a
tile replacement under an existing key.

#### Scenario: Idle frame is skipped by the frame cap
- **WHEN** an animation-frame tick occurs before the next permitted rendered frame
- **THEN** the runtime does not synchronize emitter regions or recompute accent selection for that tick

#### Scenario: Loaded tile replaces its emitter records
- **WHEN** a loaded voxel tile is refreshed with new emitter records under its existing tile key
- **THEN** the runtime reconciles the replacement before the next rendered frame uses runtime accents

### Requirement: Inactive runtime accents are transition-safe
The runtime SHALL keep the mesh-emissive strength synchronized with block-light
quality and time of day while hiding glow and point-light accents exactly once
when accents transition to an inactive state. It SHALL avoid repeated
emitter-flattening and sprite traversal while that state remains inactive.

#### Scenario: Night transitions to daytime
- **WHEN** night strength becomes zero after accents were active
- **THEN** the runtime hides active glow sprites and point lights and retains the configured daytime mesh-emissive floor

#### Scenario: Daytime remains stable
- **WHEN** accents are already inactive and night strength remains zero
- **THEN** the runtime does not rebuild the emitter list or walk every glow slot solely to keep accents hidden

### Requirement: Runtime accents are globally bounded
The viewer SHALL manage glow sprites with a fixed global pool no larger than the
highest configured glow budget. The number of block-light scene objects and
sprite materials SHALL be bounded by runtime budgets rather than decoded emitter
count or loaded tile count.

#### Scenario: Emitter-dense regions load
- **WHEN** decoded own-region emitters exceed the active glow budget
- **THEN** the runtime assigns only the selected emitters to the global glow pool and does not create one sprite or sprite material per decoded emitter

#### Scenario: Selected emitter set changes
- **WHEN** the camera-dependent selected emitter set changes
- **THEN** the runtime reuses existing glow slots and updates their position, color, scale, opacity, and visibility without retaining tile-owned sprite groups

### Requirement: Runtime accent selection remains deterministic and secondary
The runtime SHALL select at most the configured glow and point-light budgets
from own-region emitters using deterministic nearest-emitter ordering. Glow
sprites and point lights SHALL remain optional accents to baked mesh-local
emissive lighting; point lights may dynamically affect Lambert-lit voxel base
lighting but SHALL NOT alter baked emissive attributes.

#### Scenario: Multiple emitters have equal selection distance
- **WHEN** candidate emitters have equal camera distance at a selection boundary
- **THEN** the runtime applies a deterministic secondary ordering so pool assignment does not flicker between equivalent candidates

#### Scenario: High-quality point-light accents are active
- **WHEN** high block-light quality enables point-light accents near voxel geometry
- **THEN** the point lights provide bounded dynamic Lambert lighting while the baked emissive attribute and its strength uniform remain independently controlled
