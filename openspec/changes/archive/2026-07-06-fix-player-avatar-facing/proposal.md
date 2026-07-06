## Why

Player avatar models currently render facing exactly 180 degrees away from their saved Cubyz facing direction. This makes live player markers misleading: a player looking north appears to look south in the map viewer.

## What Changes

- Correct the client-side player marker yaw mapping so avatar models face the same horizontal direction represented by each player's Cubyz rotation.
- Keep existing avatar model loading, scaling, grounding, label, active/inactive, and fallback marker behavior unchanged.
- Document the player marker orientation expectation in the entity model assets capability.
- No API, payload, route, dependency, or persisted-data contract changes are planned.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `entity-model-assets`: Add a client rendering requirement that manifest-driven player marker models preserve the player's Cubyz horizontal facing direction.

## Impact

- Affected client code: `src/client/features/world-view/lib/markers.ts`.
- Affected specs: `openspec/specs/entity-model-assets/spec.md` via a delta spec in this change.
- Documentation impact: no shared API contract change; update docs only if implementation wording around player marker rendering/orientation is added or clarified.
- Verification: run `npm run check && npm run check:knip && npm run typecheck` after implementation.
