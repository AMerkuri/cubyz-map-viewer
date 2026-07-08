## Context

The voxel LOD selection pipeline computes an "effective distance" from the camera to each candidate voxel tile, then uses that distance to pick the appropriate LOD level. The current `getTileEffectiveDist` function in `voxel-lod.ts` only considers horizontal (X, Y) distance — the Z axis is completely ignored. This means when the camera is high above the terrain, tiles directly below have a horizontal distance of 0 and get LOD1 selected regardless of altitude.

The existing LOD distance thresholds already encode a consistent screen-space ratio: for every LOD level, `regionWorldSize(lod) / maxDist(lod) ≈ 0.213`. This means the thresholds were designed so that a tile's apparent angular size determines its LOD — but this only works when the distance is 3D. Adding the Z component to the distance calculation unlocks the screen-space LOD behavior that's already baked into the thresholds.

Separately, the focus LOD initialization in `voxel-focus.ts` falls back to the orbit zoom distance (camera-to-target, as low as 24) when no tiles are loaded and no raycast hits. This causes focusLod to start at LOD1 on page load, compounding the problem by requesting LOD1 tiles before the 3D distance can be measured.

## Goals / Non-Goals

**Goals:**
- Include the Z axis in voxel tile effective distance calculations so high-altitude cameras select coarser LODs for tiles below them.
- Compute a `referenceSurfaceZ` from loaded tile data with a spawn-based fallback so the vertical distance can be calculated even for unloaded root entries.
- Fix focus LOD initialization to use 3D distance (camera Z minus reference surface Z) instead of orbit zoom distance.
- Preserve existing convergence and stability behavior — the hysteresis, grace periods, and behind-camera bias still apply on top of the now-3D distance.

**Non-Goals:**
- Changing the LOD distance thresholds themselves (they already encode the right screen-space ratio).
- Adding FOV or viewport-aware screen-space LOD — that is Phase 2 (`voxel-screen-space-lod`).
- Changing the server, worker, or API contracts.
- Changing the terrain LOD system (which already uses a different distance mechanism via `syncTerrainLod`).

## Decisions

### Decision 1: Use `referenceSurfaceZ` rather than per-tile Z for distance calculation

**Choice**: Compute a single `referenceSurfaceZ` value once per LOD update cycle and use it for all tiles.

**Alternatives considered**:
- **Per-tile Z from `LoadedVoxelTile.minZ/maxZ`**: Most accurate, but `ChunkIndexEntry` (the root candidates) has no Z field. Would require two code paths: one for loaded tiles (use their `maxZ`) and one for unloaded entries (use fallback). Adds complexity for negligible benefit — at high altitude the terrain Z variation (±100) is noise compared to camera altitude (3500).
- **Raycast downward for surface Z**: Most accurate for the exact camera position, but requires a raycast on every LOD update frame, which is expensive and already used in `camera.ts` only for discrete focus events.

**Rationale**: A single reference Z is simple, fast, and sufficient. At ground level `dz ≈ 0` so accuracy doesn't matter. At high altitude the terrain variation is small relative to the altitude. The spawn Z is already used as a fallback in `camera.ts:16`.

### Decision 2: Compute `referenceSurfaceZ` from loaded tiles near camera, fallback to spawn Z

**Choice**: Scan `loadedVoxels` for tiles whose horizontal bounds contain or are near the camera position, prefer the local 4x4 chunk top-height sample at the camera X/Y, and fall back to the tile `maxZ` and then `spawn[2]` if no local sample is found. Ignore implausible high samples that are far above spawn but very close to the high-altitude camera, because those collapse the intended altitude cost back to zero.

**Rationale**: Loaded tiles near the camera provide the most accurate surface Z. As tiles load in, the reference Z becomes more precise. The spawn Z fallback ensures the system works on initial load when no tiles exist yet.

### Decision 3: Thread `referenceSurfaceZ` as a parameter, not a ref

**Choice**: Add `referenceSurfaceZ: number` as a parameter to `runVoxelLodSelection` and `updateVoxelLod`, computed by the caller before invocation.

**Rationale**: The surface Z is derived from `loadedVoxels` and `spawn`, both of which are already available in `World3DView.tsx`. Computing it at the call site keeps `voxel-lod.ts` pure — it receives the value rather than reaching into tile maps or world data. This matches the existing pattern where `cameraPosition`, `focusLod`, and other values are passed as parameters.

### Decision 4: Fix focus initialization with `camera.z - referenceSurfaceZ`

**Choice**: In `resolveVoxelLodFocus`, when no sample is found (no loaded tiles, no raycast hit, no sticky state), initialize `zoomDist` from `camera.position.z - referenceSurfaceZ` instead of `fallbackZoomDist` (orbit distance).

**Rationale**: The orbit distance (camera-to-target) can be as low as 24 on initial page load, which maps to LOD1. Using the 3D distance to the terrain surface gives a realistic initial zoom distance that maps to the correct LOD. This prevents a burst of LOD1 tile requests on page load that then need to be unloaded.

### Decision 5: Pass `referenceSurfaceZ` to `resolveVoxelLodFocus` for the initialization fix

**Choice**: Add `referenceSurfaceZ: number` parameter to `resolveVoxelLodFocus`.

**Rationale**: The focus function needs the surface Z to compute the initial distance. It's called from `checkAndUpdateLod` which has access to `loadedVoxels` and `spawn`.

## Risks / Trade-offs

- **[Risk] Surface Z inaccuracy for varied terrain** → At ground level `dz ≈ 0`, so inaccuracy is irrelevant. At high altitude, terrain variation (±100 blocks) is noise compared to altitude (3500). The only scenario where this matters is moderate altitude (100-300 blocks) above very varied terrain — but even there, the LOD boundary shift is within the hysteresis band.

- **[Risk] Initial reference Z from spawn may be wrong for non-spawn areas** → The spawn Z is a global estimate. On first load at a distant location, the initial frames may use a wrong surface Z. However, the focus smoothing (alpha=0.6) converges within 2-3 frames, and tiles loaded in those frames will provide accurate Z for the local area. The impact is limited to a few frames of slightly wrong LOD selection.

- **[Trade-off] Single reference Z vs per-tile Z** → We trade precision for simplicity. This is acceptable because the thresholds already have hysteresis, and the primary problem (LOD1 at 3500 altitude) is fully solved by any reasonable Z estimate.

- **[Risk] Existing presets may need tuning** → The existing `voxelLod1MaxDist` values (600-1150) were tuned with horizontal-only distance. With 3D distance, tiles at ground level are unaffected (`dz=0`), but at moderate altitude the effective distance increases, potentially shifting LOD boundaries. This is the desired behavior — the thresholds were screen-space-correct, just missing the Z component.

- **[Risk] Focus initialization change could affect deep-link URLs** → URLs with high Z values (e.g., `z=3500`) will now initialize with a coarser focus LOD. This is the desired behavior — the current LOD1 initialization is the bug being fixed.
