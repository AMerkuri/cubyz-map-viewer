## Why

Long-running voxel generation can leave the server at multi-gigabyte RSS even after work becomes idle because cache limits count entries rather than bytes, worker-local caches retain object graphs, and long-lived workers preserve generation high-water allocations. The server needs explicit memory budgets and lifecycle controls so voxel workloads remain predictable without changing rendered output.

## What Changes

- Add byte-aware limits and diagnostics for raw and compressed voxel mesh cache data.
- Bound worker-local represented-emitter retention by memory or source cardinality instead of a large per-worker entry count.
- Report worker memory after generation and recycle idle workers that exceed configurable high-water thresholds.
- Remove unbounded prepared emitter-summary retention and ensure invalidation clears related transient state.
- Reduce generation peaks by avoiding redundant quad, encoder, and persistent-cache payload allocations.
- Extend hermetic server tests and runtime metrics to cover cache eviction, worker recycling, and retention cleanup.
- Document the new server memory controls, metrics, and runtime lifecycle.

## Capabilities

### New Capabilities
- `voxel-memory-management`: Defines bounded voxel cache retention, worker memory lifecycle, memory diagnostics, and generation allocation requirements.

### Modified Capabilities

None.

## Impact

- Affects voxel generation, mesh caching, compression variants, emitter-summary preparation, worker protocol and pool lifecycle, and server metrics.
- Primarily touches `src/server/services/voxel-mesh-service.ts`, `voxel-worker-pool.ts`, `voxel-generator.ts`, `greedy-mesh.ts`, the voxel worker entrypoints, and server composition.
- Adds or validates server environment configuration for byte budgets and worker recycling thresholds.
- Does not change voxel HTTP payloads, compression negotiation, coordinates, or rendered mesh semantics.
- Requires updates to `docs/architecture-overview.md` and `docs/server-specification.md` because server runtime flow and operational configuration change.
