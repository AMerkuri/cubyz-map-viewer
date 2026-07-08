## MODIFIED Requirements

### Requirement: Sign text extraction

The server SHALL interpret a sign entity payload as raw UTF-8 text with no internal length prefix and no null terminator; the payload length is defined solely by the record's varint length. The parser SHALL validate the payload as UTF-8 and SHALL associate the text with the block at the record's chunk-local position.

The exposed sign text string SHALL preserve the exact Cubyz formatted source text, including formatting control characters such as color controls, emphasis toggles, escapes, resets, and newlines. The server SHALL NOT strip, normalize, or pre-render Cubyz text formatting controls when producing sign records.

A record SHALL be treated as a sign only when the block at its position resolves to a sign block via the block palette and shape classification. Non-sign block entities SHALL be ignored for sign purposes.

#### Scenario: Valid UTF-8 sign text

- **WHEN** a sign record payload is valid UTF-8 (e.g. bytes for "Hello world")
- **THEN** the parser SHALL expose the exact string as the sign text

#### Scenario: Formatted sign source text

- **WHEN** a sign record payload contains Cubyz formatting controls such as `#ff0000EVIL#000000SNALE`
- **THEN** the parser SHALL expose the exact formatted source string including those controls

#### Scenario: Multi-line sign text

- **WHEN** a sign record payload contains newline (`\n`) characters
- **THEN** the parser SHALL preserve the newlines verbatim in the sign text string

#### Scenario: Invalid UTF-8 payload

- **WHEN** a sign record payload is not valid UTF-8
- **THEN** the parser SHALL skip that record without producing a sign entry and SHALL NOT throw

### Requirement: Sign record generation during meshing

`VoxelMeshService` SHALL produce per-region sign records during voxel mesh generation, joining the sign text source (from the block-entity stream) with the sign orientation (block `data`, 0-19) and world position for each sign block in the requested region and LOD. Each sign record SHALL contain the sign's world position using the project's X/Y-horizontal, Z-vertical convention, the orientation `data` value, the formatted source text string, and the four world-space corners of the sign's text plane.

The text-plane corners SHALL be derived from the same sign geometry logic that positions the sign board, so the text plane is coplanar with the sign face and never drifts from the board.

#### Scenario: Sign record includes orientation and text-plane corners

- **WHEN** a region contains a sign block with orientation `data` and non-empty text
- **THEN** the produced sign record SHALL include the world position, the `data` value, the formatted source text, and four world-space corners describing the sign's text plane

#### Scenario: Empty-text signs

- **WHEN** a sign block has no associated block-entity record (empty text)
- **THEN** no sign record SHALL be produced for that block
