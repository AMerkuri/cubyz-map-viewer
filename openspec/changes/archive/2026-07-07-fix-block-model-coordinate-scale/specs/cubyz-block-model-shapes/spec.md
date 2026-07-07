## MODIFIED Requirements

### Requirement: Server builds block shape metadata from Cubyz assets
The server SHALL build voxel block shape metadata from the active save palette, layered Cubyz block definitions, block model OBJ assets, supported block model reference forms, and supported block rotation metadata during startup. Supported OBJ block model vertices SHALL preserve their authored block-local coordinates, including coordinates outside the `0..1` unit-block range, unless explicit supported metadata defines a different coordinate interpretation.

#### Scenario: Layered assets define a supported model block
- **WHEN** a palette entry resolves to a block definition with a supported `.model` reference in either core assets or save override assets
- **THEN** the server records shape metadata for that palette entry using the highest-priority layered asset source

#### Scenario: Texture-pile model object defines a supported plane model
- **WHEN** a palette entry resolves to a block definition using `cubyz:texture_pile` with `.model = .{ .model = <model-ref>, .states = <count> }`
- **THEN** the server records shape metadata using the referenced model asset and finite state count instead of falling back to cube geometry

#### Scenario: Block definition or model asset is unsupported
- **WHEN** a palette entry references unsupported model or rotation metadata
- **THEN** the server uses a safe fallback shape for that palette entry and logs a diagnostic without failing startup

#### Scenario: Authored model bounds exceed one block
- **WHEN** a palette entry resolves to a supported OBJ model whose authored vertex bounds extend outside the `0..1` unit-block range
- **THEN** the server records shape metadata using those authored coordinates rather than shrinking the model through an inferred `16x` downscale
