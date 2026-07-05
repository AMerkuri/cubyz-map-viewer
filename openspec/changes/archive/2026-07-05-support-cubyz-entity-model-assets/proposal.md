## Why

Cubyz 0.3.0 moved player-capable entity visuals from `assets/<namespace>/entities` OBJ files to metadata-driven `assets/<namespace>/entityModels` GLB assets. The map viewer currently hardcodes the old Snale paths, so player markers fall back instead of loading the Cubyz model on updated installations.

## What Changes

- Add a server-provided player marker asset manifest derived from layered `entityModels/*.zig.zon` metadata.
- Resolve player marker model and texture URLs from the selected entity model descriptor instead of hardcoded Snale entity paths.
- Support Cubyz 0.3.0 GLB entity model assets on the client while preserving the existing fallback marker behavior when assets are unavailable.
- Keep save-asset overrides layered above core Cubyz assets for entity model descriptors, models, and textures.
- Update documentation for the new asset route contract and client player marker loading flow.

## Capabilities

### New Capabilities

- `entity-model-assets`: Server discovery and client loading of metadata-driven Cubyz entity model assets for player markers.

### Modified Capabilities

None.

## Impact

- Server API: new or revised `/api/assets` endpoints for entity model metadata, models, and textures.
- Server parsers/services: ZON parsing for `entityModels` descriptors and layered namespace lookup for descriptor-referenced files.
- Client world view: player marker asset loading changes from fixed OBJ/PNG URLs to a manifest-driven GLB/texture load.
- Dependencies: likely add or use Three.js `GLTFLoader`; no new npm dependency expected because it ships with `three` examples.
- Docs: update `docs/architecture-overview.md`, `docs/server-specification.md`, and `docs/client-specification.md` for the shared asset manifest contract.
