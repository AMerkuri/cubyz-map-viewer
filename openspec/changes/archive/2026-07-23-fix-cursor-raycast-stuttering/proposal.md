## Why

Cursor movement over dense voxel scenes performs synchronous raycasts against the complete loaded scene, including hidden overlapping LOD meshes, causing severe frame stuttering after orbit input ends. Hover inspection should remain accurate without making pointer movement compete with rendering.

## What Changes

- Restrict voxel and terrain hover picking to geometry that is currently visible and eligible for selection.
- Coalesce high-frequency pointer movement so hover inspection cannot run repeatedly within one render opportunity.
- Preserve voxel block identity, terrain coordinate fallback, and existing suppression during active drag, touch gestures, and keyboard movement.
- Add hermetic coverage for visible candidate selection and pointer-move scheduling.
- Document the client cursor-picking runtime flow and its performance constraints.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `voxel-hover-block-identity`: Require hover picking to inspect rendered visible geometry without repeatedly blocking dense-scene rendering during pointer movement.

## Impact

- Client-only changes in `src/client/features/world-view/lib/cursor.ts` and related scene/runtime wiring or helpers.
- Client core-mechanics tests for cursor candidate selection, scheduling, and hover precedence.
- `docs/client-specification.md` updates for the cursor-picking runtime flow.
- No server, HTTP/WebSocket contract, persistence, worker protocol, or dependency changes are expected.
