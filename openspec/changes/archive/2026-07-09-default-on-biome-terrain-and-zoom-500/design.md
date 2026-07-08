## Context

The Cubyz Map Viewer initializes its layer visibility defaults in two layers of fallback logic:

1. **Storage sanitizer** (`src/client/lib/world-view-storage.ts` → `sanitizeLayerVisibility`): reads stored booleans and falls back to `false` for `biomeLabels` and `showTerrainUnderlay` when values are missing or corrupt.
2. **Runtime initializer** (`src/client/features/world-controls/WorldControlsProvider.tsx` → `createInitialLayerVisibility`): uses `storedLayerVisibility?.<key> ?? false` — the `??` fallback only fires when `storedLayerVisibility` is `null` (no localStorage payload at all).

The default camera zoom distance lives in `INITIAL_CAMERA_ZOOM` (`src/client/features/world-view/lib/constants.ts`), currently `1500`. It is consumed in `applyInitialCameraState` (`camera.ts:226`) as `zoomScale = INITIAL_CAMERA_ZOOM / baseZoom` only when **no URL camera state** is present — i.e., a fresh page load without share-link parameters. Share links supply explicit `zoom` values that bypass this constant entirely.

Storage versioning is at `GRAPHICS_SETTINGS_STORAGE_VERSION = 3`. Stored payloads with matching versions preserve all preferences, including boolean layer visibility. Changing runtime defaults does NOT retroactively change what stored booleans already read back as.

## Goals / Non-Goals

**Goals:**
- Make first-time visitors (no stored settings) see biome labels and terrain underlay enabled immediately.
- Make first-time visitors start at a closer camera distance (zoom 500) for a more useful initial view.
- Preserve existing users' persisted preferences without a forced migration.

**Non-Goals:**
- Changing default-on for `players`, `spawn`, `chunkBorders`, `voxelHeightLabels`, or `debug` layers.
- Forcing layer defaults onto existing users who have explicitly stored `false`.
- Changing share-link behavior, deep-link URL parsing, or `camera-deep-link-focus` semantics.
- Bumping the storage version or invalidating other persisted settings.

## Decisions

### Decision 1: Change two boolean defaults in both storage sanitizer and runtime initializer

**Choice:** Update fallback values in both `sanitizeLayerVisibility` (`world-view-storage.ts:49-56`) and `createInitialLayerVisibility` (`WorldControlsProvider.tsx:89,94`) from `false` to `true` for `biomeLabels` and `showTerrainUnderlay`.

**Rationale:** The fallback chain has two layers. If we only change one, existing users whose stored payload is missing these fields (corrupt/partial) would get `true` from the sanitizer, but the runtime initializer would never see `null` from `readStoredGraphicsSettings` — it would get the sanitized object. Both must agree for consistency.

**Alternatives considered:**
- *Bump storage version to 4*: Would discard ALL preferences for existing users (render distance, LOD, debug settings). Disproportionate impact for a two-boolean default change. Rejected.
- *Targeted migration logic (try to detect "was default false" vs "user turned off")*: Fundamentally ambiguous — can't distinguish intent. Rejected.
- *Add a "defaults version" field separate from storage version*: Adds complexity for marginal benefit. Rejected.

### Decision 2: Change `INITIAL_CAMERA_ZOOM` from 1500 to 500

**Choice:** Update the constant in `constants.ts:29`.

**Rationale:** `INITIAL_CAMERA_ZOOM` is only consumed as the default zoom distance when no URL camera parameters exist. Share links with explicit `zoom` bypass it. The `min`/`max` distance bounds (1 to 15000) comfortably contain 500. The resulting camera offset at zoom 500 is `Y=-400, Z=+300` (distance 500), versus the current `Y=-1200, Z=+900` (distance 1500) — a 3x closer start.

**Alternatives considered:**
- *Make zoom configurable via URL parameter with no default change*: Doesn't address the "first-time visitor too far away" problem. Rejected.
- *Persist last-used zoom in localStorage*: Scope creep and changes UX semantics (share links would conflict). Rejected.

### Decision 3: No storage version bump

**Choice:** Leave `GRAPHICS_SETTINGS_STORAGE_VERSION` at 3.

**Rationale:** Existing users with v3 payloads have explicit booleans stored. They will continue to load their own values. Changing defaults only affects new users (or users who clear localStorage). There is no data incompatibility — the schema is unchanged.

## Risks / Trade-offs

- **[Risk: Existing users don't see the new defaults]** → **Accepted.** This is the intended trade-off. Existing users who want the new behavior can manually toggle the layers on. The zoom change is universal (not persisted), so all users get the closer default on fresh loads — but this only triggers when no URL params are present, which is the common case for regular visitors.

- **[Risk: Closer zoom (500) is too close for some worlds]** → **Mitigation:** Users can scroll to zoom out. Share links preserve explicit zoom. The constant is easy to tune later. 500 is well within the `[1, 15000]` bounds.

- **[Risk: Terrain underlay ON by default increases initial load cost]** → **Mitigation:** Terrain underlay is a lightweight mesh layer. The server already serves surface tiles for LOD selection. Enabling it by default does not change the data fetching contract — it only changes whether the client renders the underlay mesh on first load. If performance is a concern, users can disable it; the toggle is in the Layer Controls panel.

- **[Risk: Biome labels ON by default clutters the view at zoom 500]** → **Mitigation:** Biome labels are already capped at `MAX_BIOME_LABELS = 120` and refreshed based on visible tiles and camera distance. The label refresh logic in `World3DView.tsx` handles dirty-flagged batched updates, so enabling by default doesn't create a new performance path — it just changes the initial `showBiomeLabels` ref value.
