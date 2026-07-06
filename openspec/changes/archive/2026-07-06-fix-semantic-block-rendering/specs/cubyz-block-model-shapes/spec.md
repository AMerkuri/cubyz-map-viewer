## MODIFIED Requirements

### Requirement: Server builds block shape metadata from Cubyz assets
The server SHALL build voxel block shape metadata from the active save palette, layered Cubyz block definitions, block model OBJ assets, supported block model reference forms, and supported block rotation metadata during startup.

#### Scenario: Layered assets define a supported model block
- **WHEN** a palette entry resolves to a block definition with a supported `.model` reference in either core assets or save override assets
- **THEN** the server records shape metadata for that palette entry using the highest-priority layered asset source

#### Scenario: Texture-pile model object defines a supported plane model
- **WHEN** a palette entry resolves to a block definition using `cubyz:texture_pile` with `.model = .{ .model = <model-ref>, .states = <count> }`
- **THEN** the server records shape metadata using the referenced model asset and finite state count instead of falling back to cube geometry

#### Scenario: Block definition or model asset is unsupported
- **WHEN** a palette entry references unsupported model or rotation metadata
- **THEN** the server uses a safe fallback shape for that palette entry and logs a diagnostic without failing startup

### Requirement: Shape assets participate in voxel cache validity
Voxel mesh cache keys SHALL include a version or signature for block shape metadata so meshes are invalidated when shape-affecting assets, supported shape interpretation semantics, or the shape payload format changes.

#### Scenario: Shape payload format changes
- **WHEN** the voxel binary coordinate format or shape generator semantics change
- **THEN** previously persisted voxel mesh cache entries are not reused

#### Scenario: Block model asset inputs change
- **WHEN** shape-affecting Cubyz block definitions or model assets change between server starts
- **THEN** generated voxel meshes reflect the current shape metadata rather than stale cached geometry

#### Scenario: Supported shape interpretation changes
- **WHEN** the server changes how a supported Cubyz model or rotation metadata form is interpreted into voxel geometry
- **THEN** generated voxel meshes reflect the new interpretation rather than stale cached geometry produced by the previous implementation
