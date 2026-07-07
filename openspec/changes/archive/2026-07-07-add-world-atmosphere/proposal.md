## Why

The 3D map viewer currently renders Cubyz worlds with readable terrain, voxel shading, and a fixed midday-style lighting setup, but the scene lacks atmosphere and time-of-day context. A restrained Phase 1 atmosphere bundle can make worlds feel more alive while preserving the authentic blocky Cubyz style and avoiding a costly cinematic rendering pipeline.

## What Changes

- Add a Cubyz-authentic world atmosphere mode that combines a configurable time-of-day value, stylized sky treatment, subtle depth enhancement, and optional low-angle sun-shaft accents.
- Keep the Phase 1 scope focused on readable, stylized atmosphere rather than high-realism rendering.
- Preserve existing terrain, voxel, marker, label, and camera behavior while applying atmosphere as a visual layer around the existing Three.js scene runtime.
- Establish future development phases for heavier visual features such as water effects, temporal anti-aliasing, cascaded shadows, PCSS soft shadows, and raymarched fly-through clouds without including them in this change.
- No server API, file format, WebSocket, or shared data contract changes are planned.

## Capabilities

### New Capabilities

- `world-atmosphere`: Viewer-side atmospheric rendering behavior for time of day, stylized sky, depth enhancement, and optional sun-shaft accents.

### Modified Capabilities

- None.

## Impact

- Client Three.js runtime under `src/client/features/world-view/`, especially scene setup, lighting, render loop integration, and any debug/control surfaces needed to expose atmosphere settings.
- Client controls/state under `src/client/features/world-controls/` if atmosphere settings need persistence or HUD/debug controls.
- Documentation in `docs/client-specification.md` if user-visible controls or runtime behavior are added.
- No server, route payload, worker protocol, Cubyz data parser, or shared client/server contract changes are expected.
