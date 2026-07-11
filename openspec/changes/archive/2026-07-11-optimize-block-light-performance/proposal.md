## Why

Block-emissive lighting scales poorly in emitter-dense worlds: idle frames still
perform block-light work, runtime accents allocate one scene object and material
per decoded emitter, and the worker allocates and fully sorts candidate objects
per lit vertex. On the server, halo collection repeats traversability work and
the 8,192-record cap can discard every boundary-relevant halo source, producing
region seams.

This change bounds optional runtime cost by visible budgets, reduces avoidable
worker and server work, and makes capped halo selection deterministic,
cache-safe, and verifiably seam-safe.

## What Changes

- Schedule block-light region synchronization and accent selection only on
  rendered frames, with transition-safe inactive-state handling and
  change-driven region reconciliation.
- Replace tile-owned, per-emitter glow sprites with a fixed global accent pool
  and bounded nearest-emitter selection while preserving optional colored glow
  and point-light accents.
- Remove per-vertex candidate object/array chains during worker emissive baking
  and use deterministic bounded candidate selection.
- Reuse halo traversability data within a generation job while preserving
  existing traversal semantics and the binary emitter layout.
- Replace own-region-first cap behavior with a deterministic,
  receiving-boundary-aware halo retention policy so dense own records cannot
  starve relevant halo lighting.
- Bump persistent voxel cache identity when the retention policy changes and
  document the resulting payload-selection behavior.
- Add measurement and seam-validation requirements, including capped dense
  boundary cases.

## Capabilities

### New Capabilities
- `runtime-block-light-performance`: Bounded, frame-scheduled runtime glow and
  point-light accent management for loaded voxel emitters.

### Modified Capabilities
- `block-emissive-lighting`: Require deterministic, boundary-safe halo record
  retention under payload caps and cache invalidation when its selection
  semantics change.
- `client-emissive-bake-performance`: Require allocation-conscious,
  deterministic bounded candidate selection during per-vertex emissive baking.
- `voxel-halo-emitter-performance`: Preserve traversal and binary-layout
  semantics while reusing halo data, and define validation for the new
  retention policy.

## Impact

- Client runtime: `scene-runtime.ts`, `block-light-runtime.ts`, memory and
  debug-stat reporting, and potentially the debug HUD.
- Client worker: `voxel-mesh.worker.ts`; the `/api/voxels` wire layout remains
  unchanged.
- Server: halo collection and emitter capping in `voxel-generator.ts`, plus
  `voxel-cache-version.ts` when selection behavior changes.
- Documentation: `docs/client-specification.md` for runtime scheduling/pooling
  behavior and `docs/server-specification.md` plus
  `docs/architecture-overview.md` for shared halo-selection/cache behavior.
- Verification: fixed-LOD visual captures, worker metrics, cache-miss halo
  measurements, deterministic payload fixtures, and the seam-validation matrix.
