## 1. Atmosphere Model And Scene Integration

- [x] 1.1 Define the client-side atmosphere state model, presets, and default time-of-day behavior without adding server contracts.
- [x] 1.2 Add a world-view atmosphere module that maps time of day to sun direction, light colors, light intensities, sky colors, and effect visibility.
- [x] 1.3 Integrate atmosphere initialization with the existing Three.js scene runtime while keeping per-frame scene state out of React state.
- [x] 1.4 Preserve the current fixed-lighting look as a safe fallback or default-equivalent baseline.

## 2. Stylized Sky And Lighting

- [x] 2.1 Replace or augment the fixed scene background with a Cubyz-stylized sky treatment driven by atmosphere state.
- [x] 2.2 Update ambient, hemisphere, main sun, and fill light values from atmosphere state.
- [x] 2.3 Verify daytime, sunrise/sunset, and night states keep terrain, voxels, labels, markers, and controls readable.

## 3. Depth Enhancement And Sun-Shaft Accent

- [x] 3.1 Implement a subtle depth-enhancement path for terrain and voxel views that does not overpower vertex colors or face shading.
- [x] 3.2 Verify transparent voxel rendering remains distinguishable when depth enhancement is active.
- [x] 3.3 Add optional restrained sun-shaft accents for low-angle sun states, or explicitly wire the option as unsupported while preserving the rest of the atmosphere system.
- [x] 3.4 Ensure atmosphere effects can be disabled or quality-scaled if they become too expensive on high-DPI or integrated-GPU setups.

## 4. Controls And Documentation

- [x] 4.1 Decide whether time of day is exposed as user-facing controls, debug controls, or fixed presets during implementation.
- [x] 4.2 If user-facing controls or persisted settings are added, wire them through the existing world-controls/app composition pattern.
- [x] 4.3 Update `docs/client-specification.md` if the implementation adds user-visible atmosphere controls, persisted settings, or visual mode behavior.
- [x] 4.4 Document future rendering phases as non-goals for this change where implementation notes or docs mention the atmosphere roadmap.

## 5. Verification

- [x] 5.1 Run `npm run check`.
- [x] 5.2 Run `npm run check:knip`.
- [x] 5.3 Run `npm run typecheck`.
- [x] 5.4 Manually inspect the viewer in terrain and voxel modes across daytime, sunrise/sunset, and night atmosphere states.
