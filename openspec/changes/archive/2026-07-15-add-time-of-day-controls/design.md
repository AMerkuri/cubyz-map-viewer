## Context

The world-view client already owns persisted visual settings in `WorldControlsProvider`. `MapControlsContent` renders the desktop Map Controls panel and the compact mobile tray, while `MapDebugParameters` exposes `atmosphereTimeOfDay` as an Advanced-only range slider. The Three.js scene runtime already reacts to changes in that setting without changing terrain, voxel, server, or world data.

The Map Controls layer toggles are currently stacked as full-width buttons. Graphics Presets use a denser two-column grid, but remain conditional on the Advanced toggle.

## Goals / Non-Goals

**Goals:**

- Make layer toggles use the same compact two-column button grid as Graphics Presets.
- Expose four always-visible, named time-of-day choices in Map Controls: Dawn, Noon, Dusk, and Midnight.
- Reuse the existing persisted `atmosphereTimeOfDay` state and rendering path.
- Preserve the Parameters slider for exact, advanced time-of-day adjustment.
- Clearly show no discrete time choice as active when the exact slider value is not one of the four named choices.

**Non-Goals:**

- Change Cubyz world time, server data, route payloads, WebSocket events, voxel payloads, or worker protocols.
- Add automatic time progression, real-world time synchronization, animation, or a time scrubber outside the existing slider.
- Change the Advanced visibility rule for Graphics Presets.
- Redesign other Map Controls or change the atmosphere lighting algorithm.

## Decisions

### Reuse the existing debug settings update path

The time buttons will receive the current `MapDebugSettings` and its existing update action through the Map Controls composition path. A button click will replace only `atmosphereTimeOfDay`, preserving every other debug and visual setting.

This avoids a second time-of-day state, duplicate persistence, and a new bridge from React controls to the imperative scene runtime. Creating separate Map Controls state was considered, but would require synchronization with the parameter slider and persisted settings.

### Use renderer-aligned fixed hour values

The button values will be Dawn `6`, Noon `12`, Dusk `18`, and Midnight `0`. These values match the atmosphere runtime's sun-angle calculation and communicate the visual states users expect.

Other hour values, such as `24` for Midnight, were rejected because the persisted setting and atmosphere runtime normalize `24` to `0`; storing the canonical value keeps active-state comparison direct.

### Keep the slider as the advanced fine-grained control

The existing Time Of Day slider remains in the Parameters panel. The Map Controls grid is a shortcut for common lighting states, not a replacement for arbitrary hours.

Exact equality determines the selected button. A slider-selected hour that is not `0`, `6`, `12`, or `18` leaves the entire button group inactive and displays a read-only `Custom` indicator beside Time Of Day. It uses the same status treatment as Graphics Presets without implying a fifth selectable lighting state.

### Keep time controls independent of Advanced

The Time Of Day grid is always rendered in Map Controls, on desktop and mobile. It makes a safe viewer-local visual setting easily discoverable. Graphics Presets retain their existing Advanced gate because they bundle performance and rendering settings intended for advanced use.

Selecting a Graphics Preset preserves the existing `atmosphereTimeOfDay` value. This keeps lighting selection exclusively under the named time buttons and Advanced slider while allowing presets to continue applying their supported graphics settings.

Graphics Preset matching also ignores `atmosphereTimeOfDay`, so changing lighting alone does not make a matching graphics configuration appear custom.

### Share the two-column button layout

Layer toggles and time choices will be rendered in two-column grids using the Graphics Presets grid as the visual and responsive precedent. The existing fifth layer toggle, Advanced, occupies one grid cell rather than being made full width. The time controls use the same active/inactive visual language as presets while remaining semantically buttons with accessible pressed state.

Extracting a general-purpose grid component is unnecessary for this small, colocated UI change; keeping layout and button styles in the existing controls components minimizes abstraction and regression surface.

## Risks / Trade-offs

- [A selected non-preset slider value provides no active time button] → This is intentional and distinguishes exact, advanced hours from named presets; the existing slider continues to show the precise value.
- [Graphics Presets ignore their configured time of day] → This keeps lighting selection independent from rendering presets and prevents an advanced graphics adjustment from unexpectedly changing the scene's lighting.
- [Compact grids make individual targets narrower] → Retain the current compact-mode padding and use the existing full-width mobile tray so each cell remains touch-accessible.
- [The controls are visual-only and could be mistaken for server world time] → Preserve the existing client-local wording and behavior; no networking or world-data path is introduced.
