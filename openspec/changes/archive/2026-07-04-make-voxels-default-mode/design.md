## Context

The client currently models the world view as either `terrain` or `voxel`. URL state, control state, HUD controls, chunk-index loading, debug stats, layer visibility, and the Three.js scene all receive or derive behavior from that mode. The visible entry point for switching modes is the terrain/voxel selector in the top-right toolbar.

Voxel rendering is now the primary user experience. Terrain mode should no longer be exposed as a selectable mode, and the app should not require a user interaction before voxel-specific data, especially the chunk index, begins loading.

## Goals / Non-Goals

**Goals:**

- Start every viewer session in voxel mode, including sessions opened from old or missing `mode` URL parameters.
- Remove the HUD terrain/voxel selector so users cannot switch into terrain mode through the UI.
- Load voxel prerequisites immediately on startup.
- Keep share-location behavior coherent for voxel-only operation.
- Update client documentation for the new runtime flow.

**Non-Goals:**

- Remove all terrain rendering code from the scene runtime.
- Remove the voxel-mode terrain underlay layer toggle.
- Change server APIs, voxel payload formats, WebSocket event names, coordinates, or LOD contracts.
- Redesign the HUD beyond removing the obsolete mode selector.

## Decisions

### Soft-disable terrain mode instead of deleting all terrain internals

Keep the internal `WorldViewMode` union and terrain runtime branches unless they become unused naturally during implementation. Force initialization and reachable UI behavior to voxel mode.

Alternative considered: hard-remove `terrain` from types and delete terrain branches. That would produce a cleaner type model but would be a larger scene/runtime refactor with higher risk, especially because voxel mode can still use a terrain underlay and shared terrain caches.

### Make URL mode parsing voxel-only

`readInitialMode()` should return `voxel` for missing, `terrain`, invalid, or legacy mode values. This preserves old links while avoiding terrain-mode startup.

Alternative considered: remove mode parsing entirely from page startup. Keeping a small parser is less disruptive and allows share-location code to retain its existing state shape if desired.

### Remove the selector at the composition boundary

Remove `ViewToggle` usage from `TopRightToolbar` and stop threading `view`/`onViewChange` props through the toolbar. This keeps the UI removal local and avoids unnecessary changes to lower-level scene code.

Alternative considered: render a disabled single `Voxels` pill. The request says the selector is no longer needed, so removing it avoids misleading affordances.

### Keep voxel chunk-index loading enabled from initial state

Because voxel is the default and only reachable mode, `chunkIndexEnabled` should be true at startup. This aligns data loading with visible behavior and removes the previous lazy-load-on-switch dependency.

Alternative considered: continue deriving chunk-index loading from `state.view === "voxel"`. That works if state is always voxel, but explicitly initializing the flag as enabled better documents the new flow and protects against legacy URL input.

### Preserve voxel-mode layer controls

Controls that only appear in voxel mode, including terrain underlay and voxel height labels, should remain available because the app will always be in voxel mode. Removing those controls would be a separate product decision.

## Risks / Trade-offs

- Legacy terrain-mode code remains present -> Mitigation: keep the implementation minimal now; a later cleanup can hard-remove terrain mode after verifying underlay/runtime dependencies.
- Old share links may still include `mode=voxel` even though mode is no longer user-selectable -> Mitigation: either keep the parameter harmlessly for compatibility or remove it consistently from share URL state during implementation.
- Chunk-index loading moves earlier in startup -> Mitigation: this is expected for voxel-first behavior; verify loading/error UI still handles chunk-index failures.
- Removing toolbar props can cascade through imports/types -> Mitigation: run Biome, Knip, and TypeScript checks to catch unused components, exports, and stale props.
