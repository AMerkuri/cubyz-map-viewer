## ADDED Requirements

### Requirement: Player marker avatar facing matches player rotation
The client SHALL render manifest-driven player marker avatar models so their horizontal facing direction matches the player's Cubyz yaw from the `/api/players` rotation payload.

#### Scenario: Player faces a cardinal direction
- **WHEN** `/api/players` returns a player with a supported `entityModelId` and a rotation representing a known horizontal Cubyz facing direction
- **THEN** the rendered avatar marker model faces that same horizontal direction in the world view instead of the opposite direction

#### Scenario: Player rotation changes
- **WHEN** an existing player's rotation changes and the client refreshes player markers after a `players-updated` invalidation or query refresh
- **THEN** the existing marker updates to the new matching horizontal facing direction without recreating unrelated marker state
