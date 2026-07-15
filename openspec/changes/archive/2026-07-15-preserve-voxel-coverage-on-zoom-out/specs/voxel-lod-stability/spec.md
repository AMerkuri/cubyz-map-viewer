## MODIFIED Requirements

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
