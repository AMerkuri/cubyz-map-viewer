## Why

Zooming out can hide loaded fine voxel chunks as soon as an unloaded coarse ancestor becomes the desired LOD, leaving a visible hole while the replacement is fetched, meshed, and inserted into the scene. Loaded-resource grace and server warm caching do not prevent this because visibility is removed before the fine chunks are unloaded.

## What Changes

- Retain already-loaded fine descendants as visible fallback coverage while their desired coarse ancestor is not scene-ready.
- Discover fallback descendants without scheduling obsolete fine-detail work solely to complete the fallback.
- Switch visibility to the coarse ancestor only after it has been inserted into the loaded scene state, then allow the normal unload grace and warm-cache policy to retire the fine descendants.
- Add deterministic client LOD regression coverage for the multi-pass fine-to-coarse handoff.
- Update the client runtime documentation to describe readiness-gated transitions in both LOD directions.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `voxel-lod-stability`: Require loaded fine descendants to preserve visible coverage until a desired coarse replacement is scene-ready during zoom-out and view-driven coarsening.

## Impact

- Client voxel selection and visibility reconciliation in `src/client/features/world-view/lib/voxel-lod.ts`.
- Hermetic client LOD tests in `test/core/client/voxel-view-lod.test.ts`.
- Client runtime behavior documentation in `docs/client-specification.md`.
- No server API, payload, worker protocol, dependency, or shared client/server contract changes.
