## Context

The previous voxel-default change intentionally soft-disabled terrain mode: the app initializes as voxel, the terrain/voxel selector is gone, and voxel prerequisites load immediately. It kept the internal `WorldViewMode` union and terrain runtime branches to avoid a risky scene refactor while terrain underlay and terrain data remained useful.

That compromise left user-facing and control-layer remnants: share URLs still include `mode=voxel`, share state still carries a mode field, control state still stores `view`, persistence still remembers terrain-mode-only layer fields, and several components gate voxel controls behind a mode that is now always voxel.

The remaining terrain concept is not a mode. It is an optional underlay inside the voxel scene plus terrain-derived data used by biome labels, terrain invalidation, and coordinate hover fallback.

## Goals / Non-Goals

**Goals:**

- Make share-location URLs camera-only and independent of world-view mode.
- Remove user/control-layer mode plumbing that cannot affect reachable behavior.
- Rename terrain visibility state to describe terrain underlay rather than standalone terrain mode.
- Keep voxel-specific controls visible without checking a now-constant mode value.
- Preserve terrain underlay, terrain data loading when underlay is enabled, biome labels, surface update handling, and coordinate hover behavior.
- Update documentation to describe the current voxel-only runtime model.

**Non-Goals:**

- Remove terrain mesh generation, terrain HTTP APIs, surface index loading, biome payloads, or terrain invalidation behavior.
- Change server APIs, WebSocket event names, voxel payloads, compression negotiation, coordinates, or LOD contracts.
- Redesign the HUD or debug panels beyond removing obsolete mode assumptions.
- Move per-frame scene state into React state.

## Decisions

### Treat voxel mode as implicit at the app/control boundary

The app and controls should stop carrying a `WorldViewMode` value for user-reachable behavior. `WorldControlsProvider` no longer needs an `initialMode` prop, `state.view`, or per-mode biome label memory because the only reachable view is voxel.

Alternative considered: keep `WorldViewMode` everywhere and only remove `mode=voxel` from share URLs. That would fix the visible redundancy but leave most cleanup value unrealized.

### Keep legacy URL mode tolerance without generated mode state

Generated share links should omit `mode`, but old links containing `mode=terrain`, `mode=voxel`, or invalid mode values should continue to open the voxel scene. This can be achieved by removing mode parsing from initialization or by making any remaining parsing a no-op compatibility boundary.

Alternative considered: reject or strip legacy mode params on load. That adds behavior without user value; simply ignoring them keeps old links harmless.

### Rename terrain visibility around underlay behavior

Control and persistence naming should move from `showTerrain` / `showVoxelTerrain` toward `showTerrainUnderlay`, matching the only exposed terrain display behavior. Since settings are already versioned, this cleanup can bump the storage version and fall back to defaults instead of preserving obsolete terrain-mode preferences.

Alternative considered: migrate every old storage field into the new shape. The old terrain-mode fields are local UI preferences and not persisted project data, so a version bump is simpler and lower risk.

### Preserve terrain runtime services before hard-removing deep branches

Runtime terrain code remains necessary for underlay rendering and terrain-derived data. The implementation should remove constant mode checks where straightforward, but it should not delete terrain managers, terrain queues, or surface-index flows just because standalone terrain mode is gone.

Alternative considered: hard-remove every `mode === "terrain"` branch in one pass. That is higher risk because terrain underlay, biome labels, debug overlays, and live update invalidation still share terrain infrastructure.

## Risks / Trade-offs

- Stored graphics/layer preferences may reset after the storage version changes -> Acceptable because these are local UI preferences and older versions are already discarded by the storage reader.
- Removing mode types can cascade through scene props and helper signatures -> Mitigate with small boundary-first changes and run Biome, Knip, and TypeScript checks.
- Over-aggressive terrain cleanup could break underlay or biome labels -> Keep terrain data/rendering internals unless a reference is demonstrably obsolete after mode removal.
- Docs could become too absolute and imply terrain APIs are gone -> Explicitly document voxel-only user flow while preserving terrain underlay and terrain-derived data roles.
