## Purpose

Define how Cubyz sign block-entity data is decoded, associated with voxel mesh regions, and exposed to clients.

## Requirements

### Requirement: Block-entity stream decoding

The server SHALL decode the block-entity stream that follows the block-array stream in each `.region` chunk blob instead of skipping it. For chunks whose block-array compression algorithm carries block entities, after reading the block array the parser SHALL treat the remaining chunk bytes as the block-entity stream and parse it.

The block-entity stream format SHALL be interpreted as: an optional leading `u8` compression algorithm byte (`0` = raw) present only when the stream is non-empty, followed by zero or more entity records until the chunk blob ends. Each record SHALL consist of a 2-byte big-endian block-position index (a `u15` packed as `index = (x << 10) | (y << 5) | z` within the 32x32x32 chunk), a LEB128 varint payload length, and that many raw payload bytes.

#### Scenario: Chunk with no block entities

- **WHEN** a chunk blob has no remaining bytes after the block array
- **THEN** the parser SHALL produce an empty set of sign entries for that chunk and SHALL NOT error

#### Scenario: Chunk with a sign entity

- **WHEN** a chunk blob contains a block-entity stream with one record whose block position maps to a sign block in the block array
- **THEN** the parser SHALL emit a sign entry containing the chunk-local block position, the block `data` value from the block array at that position, and the decoded text payload

#### Scenario: Malformed or truncated entity stream

- **WHEN** the block-entity stream ends before a complete record can be read
- **THEN** the parser SHALL stop consuming records safely, emit the records already parsed, and SHALL NOT throw

### Requirement: Sign text extraction

The server SHALL interpret a sign entity payload as raw UTF-8 text with no internal length prefix and no null terminator; the payload length is defined solely by the record's varint length. The parser SHALL validate the payload as UTF-8 and SHALL associate the text with the block at the record's chunk-local position.

A record SHALL be treated as a sign only when the block at its position resolves to a sign block via the block palette and shape classification. Non-sign block entities SHALL be ignored for sign purposes.

#### Scenario: Valid UTF-8 sign text

- **WHEN** a sign record payload is valid UTF-8 (e.g. bytes for "Hello world")
- **THEN** the parser SHALL expose the exact string as the sign text

#### Scenario: Multi-line sign text

- **WHEN** a sign record payload contains newline (`\n`) characters
- **THEN** the parser SHALL preserve the newlines verbatim in the sign text string

#### Scenario: Invalid UTF-8 payload

- **WHEN** a sign record payload is not valid UTF-8
- **THEN** the parser SHALL skip that record without producing a sign entry and SHALL NOT throw

### Requirement: Sign record generation during meshing

`VoxelMeshService` SHALL produce per-region sign records during voxel mesh generation, joining the sign text (from the block-entity stream) with the sign orientation (block `data`, 0-19) and world position for each sign block in the requested region and LOD. Each sign record SHALL contain the sign's world position using the project's X/Y-horizontal, Z-vertical convention, the orientation `data` value, the text string, and the four world-space corners of the sign's text plane.

The text-plane corners SHALL be derived from the same sign geometry logic that positions the sign board, so the text plane is coplanar with the sign face and never drifts from the board.

#### Scenario: Sign record includes orientation and text-plane corners

- **WHEN** a region contains a sign block with orientation `data` and non-empty text
- **THEN** the produced sign record SHALL include the world position, the `data` value, the text, and four world-space corners describing the sign's text plane

#### Scenario: Empty-text signs

- **WHEN** a sign block has no associated block-entity record (empty text)
- **THEN** no sign record SHALL be produced for that block

### Requirement: Sign records HTTP route

The server SHALL expose an HTTP route that returns per-region sign records as JSON, keyed by LOD and region coordinates consistent with the voxel/region addressing scheme. The route SHALL obtain sign records through `VoxelMeshService` and SHALL NOT bypass it. The binary voxel mesh payload SHALL remain geometry-only; sign records SHALL be served exclusively through this separate route.

#### Scenario: Fetching sign records for a region

- **WHEN** a client requests sign records for a valid LOD and region coordinate
- **THEN** the server SHALL respond with a JSON array of sign records for that region

#### Scenario: Region with no signs

- **WHEN** a client requests sign records for a region that contains no signs
- **THEN** the server SHALL respond with an empty JSON array
