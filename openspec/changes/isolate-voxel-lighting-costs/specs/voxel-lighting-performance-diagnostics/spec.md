## ADDED Requirements

### Requirement: Diagnostic matrix isolates voxel lighting costs
The system SHALL provide debug-only controls or configuration that independently disables server halo-emitter inclusion and client emissive-attribute baking for voxel lighting diagnostics, while preserving current behavior by default.

#### Scenario: Current behavior remains the default
- **WHEN** no diagnostic voxel-lighting cost isolation setting is active
- **THEN** LOD 1 voxel payloads include configured halo emitter data and the client worker bakes mesh-local emissive attributes according to the normal block-light settings

#### Scenario: Halo disabled and emissive enabled
- **WHEN** the diagnostic matrix disables server halo emitters while leaving client emissive attributes enabled
- **THEN** LOD 1 voxel payload generation omits neighboring-region halo emitter records and the client still bakes mesh-local emissive attributes from remaining payload emitter records

#### Scenario: Halo enabled and emissive disabled
- **WHEN** the diagnostic matrix leaves server halo emitters enabled while disabling client emissive attributes
- **THEN** LOD 1 voxel payload generation includes halo emitter records and the client worker skips creating or uploading mesh-local emissive attributes

#### Scenario: Both diagnostics disabled
- **WHEN** the diagnostic matrix disables both server halo emitters and client emissive attributes
- **THEN** LOD 1 voxel payload generation omits neighboring-region halo emitter records and the client worker skips creating or uploading mesh-local emissive attributes

### Requirement: Diagnostics report phase-specific metrics
The system SHALL expose metrics sufficient to compare server halo-emitter cost against client emissive-attribute cost for the same scene and diagnostic matrix state.

#### Scenario: Server metrics include halo-specific data
- **WHEN** a voxel payload is generated or served under a diagnostic matrix state
- **THEN** server-visible metrics include own emitter record count, halo emitter record count, and timing or equivalent phase data that separates halo-emitter work from total voxel generation work

#### Scenario: Client metrics include emissive output data
- **WHEN** the client worker decodes a voxel payload under a diagnostic matrix state
- **THEN** client-visible benchmark data includes worker decode time, worker output bytes, and emissive-attribute output bytes or an equivalent indicator of emissive geometry contribution

#### Scenario: Diagnostic mode changes
- **WHEN** the active diagnostic matrix state changes
- **THEN** voxel benchmark averages are reset or separated so samples from different matrix states are not averaged together as one result

### Requirement: Diagnostics do not contaminate normal payload caches
The system SHALL prevent diagnostic payload modes from being confused with normal voxel payload cache entries.

#### Scenario: Halo-disabled diagnostic payload is generated
- **WHEN** diagnostic mode generates or serves a payload that omits halo emitters differently from normal behavior
- **THEN** that payload is not reused as the normal cached payload after diagnostics are disabled

#### Scenario: Normal cached payload exists
- **WHEN** a diagnostic matrix state requires payload contents that differ from normal behavior
- **THEN** the system MUST NOT let an existing normal cached payload hide the cost or content difference being measured
