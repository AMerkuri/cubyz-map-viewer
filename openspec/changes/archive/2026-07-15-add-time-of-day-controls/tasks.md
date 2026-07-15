## 1. Map Controls Layout

- [x] 1.1 Convert the `LayerControls` layer-visibility buttons to the compact two-column grid layout used by Graphics Presets, including desktop and compact mobile presentation.
- [x] 1.2 Preserve existing layer-toggle behavior, active styling, and accessible button semantics in the compact grid.

## 2. Discrete Time Of Day Controls

- [x] 2.1 Thread the existing map debug settings and update action through Map Controls composition for both the desktop panel and mobile HUD tray.
- [x] 2.2 Add an always-visible `Time Of Day` control grid with Dawn (6), Noon (12), Dusk (18), and Midnight (0) buttons that updates only `atmosphereTimeOfDay`.
- [x] 2.3 Match the selected-time button using exact values, show a `Custom` indicator and leave all time buttons inactive for custom slider values, retain the Advanced Parameters slider, and keep Graphics Presets gated behind Advanced without allowing them to change Time Of Day or lose their active state when only Time Of Day changes.

## 3. Verification

- [x] 3.1 Manually verify desktop and mobile Map Controls: compact toggle layout, each named time selection, inactive state for an arbitrary slider time, and the Advanced-only Graphics Presets behavior that preserves the selected time.
- [x] 3.2 Run `npm test`, `npm run check`, `npm run check:knip`, and `npm run typecheck`.
