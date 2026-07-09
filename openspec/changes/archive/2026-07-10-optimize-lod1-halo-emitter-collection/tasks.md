## 1. External Region Cache

- [x] 1.1 Add generation-local external region loader/cache keyed by LOD, normalized region X/Y, and region world Z.
- [x] 1.2 Route `loadExternalChunk()` through the shared external region loader instead of parsing region files directly per chunk access.
- [x] 1.3 Ensure halo candidate reads, boundary checks, ambient-occlusion checks, and halo open-face checks all benefit from the same external region cache.
- [x] 1.4 Preserve missing-file and parse-error behavior for external chunks, including existing warning behavior where appropriate.

## 2. Halo Collection Behavior

- [x] 2.1 Keep `collectHaloEmitterRecords()` scan bounds, halo radius, record coordinates, color values, open-face masks, sort order, and halo flag semantics behaviorally compatible with current output.
- [x] 2.2 Preserve diagnostic `halo=0` behavior so halo-disabled payloads bypass neighboring halo collection while keeping own-region emitters.
- [x] 2.3 Verify persistent voxel cache identity does not need to change because payload content and binary layout remain unchanged.

## 3. Metrics And Diagnostics

- [x] 3.1 Add aggregate worker stats for external region cache behavior, such as parse count, cache hit count, missing file count, and parse error count.
- [x] 3.2 Surface the new metrics through `VoxelMeshService` and `/api/voxels/metrics` without bypassing existing voxel service layering.
- [x] 3.3 If route headers or HUD fields are added, keep cached-generation timing distinct from current-generation timing.
- [x] 3.4 Confirm existing halo timing and own/halo emitter counts still report correctly for worker-generated and cached payloads.

## 4. Documentation

- [x] 4.1 Update `docs/server-specification.md` with optimized halo collection behavior and any new metrics.
- [x] 4.2 Update `docs/architecture-overview.md` if shared diagnostic metrics or voxel generation runtime flow changes.
- [x] 4.3 Update `docs/client-specification.md` only if the debug HUD or client-consumed diagnostic contract changes.

## 5. Verification

- [x] 5.1 Run `npm run check`.
- [x] 5.2 Run `npm run check:knip`.
- [x] 5.3 Run `npm run typecheck`.
- [x] 5.4 Run `npm run build` because voxel worker stats and server payload generation are involved.
- [x] 5.5 Re-run the reduced-scope `SEASON3` benchmark comparing halo off and halo on with fresh voxel caches, recording backend worker average, max run time, halo timing, external region parse/cache counters, cache mix, and loaded chunk count.
- [x] 5.6 Confirm default halo-enabled rendering still shows cross-region emitted-light cues and diagnostic halo-disabled rendering still omits neighboring halo emitters.
