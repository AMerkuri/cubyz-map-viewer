## Context

The client voxel worker decodes cached `/api/voxels` binary payloads into quadrant mesh arrays. When emissive attributes are enabled, the optimized payload path reads emitter records, builds a spatial emitter grid, allocates per-vertex emissive color arrays, and calls `accumulateEmitterLight()` for every opaque vertex.

The current emitter grid uses string keys (`"x,y,z"`) and each vertex probes up to 27 neighboring grid cells. Every candidate can then run direction transmission, distance, square root, smoothstep falloff, lambert weighting, hue bias, and clamping. The emitted-light output is currently a `Float32Array` `vec3` attribute, which costs 12 bytes per lit vertex before GPU upload overhead.

Cached-payload benchmarks at the target `SEASON3` location showed emissive attributes increasing worker decode/bake time from roughly `32.5 ms` to `392.0 ms`, adding about `1.9 MB` of emissive bytes and increasing worker output by about `3.2 MB` per averaged sample. Server-side halo cost is no longer the main bottleneck for this benchmark.

## Goals / Non-Goals

**Goals:**

- Reduce client worker emissive bake CPU cost without changing default emitted-light appearance in meaningful ways.
- Reduce emissive attribute transfer/upload size.
- Preserve the existing server voxel binary payload contract.
- Preserve existing runtime glow/point-light accents and block-light quality controls.
- Keep the diagnostic emissive on/off switch useful for before/after measurement.
- Add focused metrics so future benchmarks can distinguish decode, grid build, emissive bake, and output-size effects.

**Non-Goals:**

- Move emitted-light baking to the server.
- Replace mesh-local lighting with GPU dynamic light loops.
- Change emitted-light radius, intensity, directional wrap, color semantics, or halo record semantics as a first step.
- Optimize transparent mesh lighting; transparent quads currently keep emissive attributes disabled.
- Implement coarser LOD emitter aggregation.

## Decisions

### Decision: Replace string-keyed emitter grid lookups with numeric dense indexing

The emitter grid should use numeric cell coordinates and a dense local cell array or equivalently allocation-conscious numeric structure so per-vertex neighborhood probes avoid creating string keys. The grid can compute min/max emitter cell bounds during construction and map `(ix, iy, iz)` to a local array index.

This is behavior-preserving because it changes lookup mechanics, not falloff, candidates, radius, or emitter records.

Alternatives considered:

- Keep `Map<string, number[]>` and only add culling. Rejected because string construction sits directly in the hottest loop.
- Use a global sparse `Map<number, number[]>` hash. Viable, but dense local indexing is simpler when each payload has bounded emitter extents.
- Move all lighting to shader uniforms/textures. Rejected for this change because it is a larger rendering architecture shift and risks per-fragment cost explosion with many emitters.

### Decision: Add conservative quad-level emissive culling

Before accumulating emitted light for a quad's four vertices, the worker should cheaply determine whether the quad can receive any emitter contribution. A conservative test can use the quad bounding box expanded by the emitted-light radius, or query emitter-grid cells overlapped by the quad bounds.

False positives are acceptable because they only keep existing work. False negatives are not acceptable because they would remove visible light.

Alternatives considered:

- Per-vertex culling only. Rejected because the current hot loop already performs per-vertex grid probes; culling must avoid entering that path for far-away quads.
- Center-point-only quad distance checks. Rejected because large greedy quads can intersect light radius even when their center is far away.

### Decision: Use compact normalized emissive attributes if visual quality holds

The emissive attribute values are clamped to `0..1`, so they can be encoded as normalized integer attributes. `Uint8Array` normalized attributes reduce emissive bytes by 4x compared with `Float32Array`; `Uint16Array` normalized attributes reduce bytes by 2x while offering more precision.

The first implementation should prefer `Uint8Array` normalized attributes if visual comparison shows no objectionable banding. If banding is visible around smooth gradients, fall back to `Uint16Array` normalized attributes.

Alternatives considered:

- Keep `Float32Array` output. Rejected because benchmark output size is a significant part of the cost and GPU upload path.
- Pack emissive into base colors. Rejected because block-light strength changes with time of day and quality controls through a shader uniform; baking into base colors would lose that runtime gating.
- Use a scalar intensity plus emitter hue elsewhere. Rejected because current lighting carries colored per-surface radiance and would lose hue fidelity.

### Decision: Lazily allocate emissive arrays per quadrant

Quadrant writers should avoid allocating emissive arrays until a vertex actually receives a non-zero contribution. If no vertex in a quadrant is lit, no emissive attribute should be transferred or uploaded for that quadrant.

Alternatives considered:

- Allocate for every opaque quadrant when emitters exist. Rejected because it creates unnecessary worker memory and GC pressure.
- Precompute exact lit vertex counts. Rejected because it would add another full traversal and likely duplicate work.

### Decision: Add debug-only emissive bake phase metrics

Worker benchmark output should expose enough phase timing and counters to validate the optimization: grid build time, emissive bake time, emitted-light candidate checks or vertices evaluated, and emitted-light output bytes. These should remain debug/benchmark metrics and not become user-facing controls.

Alternatives considered:

- Use only existing `Avg decode` and `Avg emissive bytes`. Rejected because they cannot distinguish lookup CPU, culling effectiveness, and transfer-size wins.

## Risks / Trade-offs

- Compact normalized attributes can introduce visible banding -> Compare screenshots at night/low light and use `Uint16Array` if `Uint8Array` is not visually stable.
- Dense grids can allocate too much memory if emitter extents are pathological -> Bound allocation by payload emitter extents and fall back to a sparse numeric map if the dense grid would be too large.
- Conservative quad culling can accidentally drop light if implemented too tightly -> Use expanded quad bounds and prefer false positives over false negatives.
- Metrics can clutter benchmark data -> Keep them scoped to worker benchmark output and document only stable fields.
- Type changes can break geometry upload assumptions -> Update shared worker types and use Three.js normalized `BufferAttribute` correctly.

## Migration Plan

1. Add worker metrics around current emissive grid and bake phases if useful for baseline confirmation.
2. Replace string-keyed grid lookup with numeric dense or fallback sparse numeric indexing.
3. Add conservative quad-level culling before per-vertex accumulation.
4. Switch emissive output to normalized integer attributes if visual quality is acceptable.
5. Add lazy per-quadrant emissive allocation.
6. Update docs for worker output representation and debug metrics if exposed.
7. Run standard verification plus `npm run build`.
8. Re-run cached-payload emissive OFF/ON benchmark at the same `SEASON3` camera location and compare decode, output bytes, and visual quality.

## Open Questions

- Should the first implementation choose `Uint8Array` directly, or implement `Uint16Array` fallback behind a constant for quick visual tuning?
- What maximum dense-grid cell count should trigger fallback to sparse numeric indexing?
- Should emissive phase metrics appear in the HUD, or only in benchmark sample internals/logged data?
