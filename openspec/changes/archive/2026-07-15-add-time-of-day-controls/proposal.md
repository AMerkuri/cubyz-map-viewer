## Why

The Map Controls panel currently uses full-width layer-toggle buttons and exposes no quick way to preview the existing client-local time-of-day lighting. Users must open Advanced and operate a fine-grained parameter slider for common lighting states.

## What Changes

- Arrange Map Controls layer toggles in a compact two-column grid that matches the Graphics Presets button layout.
- Add an always-visible `Time Of Day` button grid in Map Controls with Dawn, Noon, Dusk, and Midnight lighting choices.
- Connect the time buttons to the existing client-local atmosphere time-of-day setting and preserve the existing Parameters slider for fine-grained control.
- Represent a non-preset slider time as a custom time selection with a `Custom` indicator and all four Map Controls time buttons inactive.
- Keep Graphics Presets gated behind Advanced without allowing them to change the selected time of day.

## Capabilities

### New Capabilities

- `map-controls-layout`: Present Map Controls layer toggles as a compact grid that matches the preset control density.

### Modified Capabilities

- `world-atmosphere`: Provide discrete Map Controls access to the existing client-local atmosphere time-of-day setting while retaining fine-grained advanced control.

## Impact

- Client UI and state wiring in `src/client/features/world-controls/` and `src/client/app/components/WorldViewHud.tsx`.
- Reuses the existing `MapDebugSettings.atmosphereTimeOfDay` persistence and Three.js atmosphere runtime; no server API, WebSocket, worker, Cubyz data contract, dependency, or documentation changes are expected.
