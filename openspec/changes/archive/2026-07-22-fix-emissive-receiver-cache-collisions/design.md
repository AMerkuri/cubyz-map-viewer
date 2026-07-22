## Context

The voxel worker indexes emitter influence in three-dimensional cells and optionally caches the deduplicated candidate union for each receiver cell. The current helper encodes signed 21-bit X, Y, and Z coordinates into a JavaScript `number` as though it were a 63-bit integer. Values are already around `4.6e18` near the reported structure, well above `Number.MAX_SAFE_INTEGER`, so many distinct Z coordinates compare as the same `Map` key.

The collision affects two paths. The production receiver-neighborhood cache can reuse an empty or unrelated candidate union for another height, producing missing light. The sparse emitter-grid fallback uses the same key and can alias buckets when a payload exceeds the dense-grid allocation bound. The reported payload uses a dense emitter grid, so disabling receiver caching restores its light, but both paths need collision-free behavior.

The current architecture already retains an uncached 27-cell discovery path, per-job cache accounting, cached/uncached benchmark modes, and progressive enhancement isolation. The server payload and renderer do not need to change.

## Goals / Non-Goals

**Goals:**

- Give every supported three-dimensional emitter and receiver cell an exact identity.
- Preserve cached-versus-uncached byte parity for emissive arrays at realistic positive, negative, and non-origin world coordinates.
- Retain the low-allocation numeric fast path for normal dense emitter grids.
- Preserve bounded cache accounting and correctness-first uncached fallback behavior.
- Cover the reported vertical-alias failure shape and the sparse-grid fallback with hermetic regressions.

**Non-Goals:**

- Change emitter extraction, halo collection, propagation radius, attenuation, greedy geometry, or shader presentation.
- Change the voxel binary payload, HTTP API, worker message protocol, runtime quality presets, or persistent caches.
- Guarantee that every face fragment receives physically simulated light; emissive contribution remains vertex-baked.
- Optimize the uncached or sparse fallback beyond avoiding regressions that make it impractical.

## Decisions

### Use local linear receiver identities for dense grids

The common dense-grid path will derive a receiver-cache domain from the emitter grid's local bounds expanded by the one-cell neighborhood probe radius. A receiver inside that domain receives a zero-based linear index computed from local coordinates. The domain dimensions are bounded alongside dense-grid allocation, and the implementation will explicitly verify that the resulting index is a safe integer before cache use.

Receivers outside the expanded domain cannot overlap a populated dense bucket. They may return the immutable empty neighborhood without insertion, or use uncached discovery if that keeps control flow simpler. They must not be assigned a lossy global coordinate key.

This is preferred over global string keys because it avoids allocation on every dense-path lookup, and over `bigint` on the common path because the payload already supplies a compact local coordinate system. A hash-only numeric key was rejected because correctness would still require collision buckets and coordinate verification.

### Use exact sparse bucket identity and uncached receiver discovery for sparse grids

The sparse emitter-grid fallback will use an exact key representation for its full supported signed coordinate range. A packed `bigint` is the preferred representation because it preserves the existing 21-bit-per-axis layout without string allocation or ambiguous hashing. Inputs remain range-checked before packing.

Receiver-neighborhood caching will initially remain disabled when the emitter grid is sparse or a receiver cannot use the verified dense local identity. Those vertices will use the existing uncached 27-cell discovery path. Sparse mode is already a bounded-allocation fallback; accepting additional lookup cost is preferable to introducing a second complex cache representation in this correctness fix.

Nested numeric maps and coordinate strings were considered. Nested maps preserve exactness but add substantial object overhead to every sparse bucket; strings are simple but allocate during each probe. Either remains an acceptable implementation fallback if measurement shows packed `bigint` is unsuitable, provided tests prove exact identity and sparse behavior remains bounded.

### Treat uncached output as the correctness oracle

The existing uncached candidate discovery remains the normative comparison path. Cached and uncached runs must produce byte-identical quadrant emissive arrays for fixtures spanning multiple receiver heights, realistic world offsets, negative coordinates, own and halo emitters, coarse LOD representatives, and cache-pressure fallback.

The reported payload demonstrated one-way loss: cached output omitted 54,294 channels produced by uncached output. Acceptance therefore compares complete arrays rather than aggregate emissive energy, emitter counts, or screenshots. Aggregate checks alone can pass while individual vertical sections remain dark.

### Keep the change internal to the voxel worker

No server regeneration, payload version, worker protocol field, or Three.js material change is required. Existing candidate-cache metrics retain their meanings. Documentation will clarify that dense receiver identities are payload-local and that unsupported cache identities fall back to deterministic uncached discovery.

## Risks / Trade-offs

- [Expanded dense receiver domains overflow or consume excessive storage] -> Cache remains a bounded `Map` keyed by verified local indices rather than allocating a full receiver array, and unsafe indices fall back to uncached discovery.
- [Sparse exact keys increase worker time] -> Restrict the exact sparse representation to the existing fallback path and record a focused sparse regression or benchmark.
- [A partial fix repairs receiver caching but leaves sparse buckets lossy] -> Add an explicit sparse-grid collision fixture with equal X/Y and distinct Z buckets.
- [Parity tests pass only near the origin] -> Place receivers and emitters at the reported coordinate scale and at negative offsets, with multiple Z cells sharing X/Y.
- [Immediate rollback reduces lighting throughput] -> The uncached mode is already supported and correctness-preserving; it remains the rollback until the collision-free cached path passes parity.
- [Progressive enhancement obscures validation] -> Test the pure production worker in both modes and use the live camera only as a final presentation check.

## Migration Plan

1. Add failing regressions that reproduce vertical receiver-key aliasing and sparse bucket aliasing.
2. Switch or retain the production default as uncached while the collision-free representation is introduced, if needed to keep intermediate commits correct.
3. Implement exact sparse keys and verified dense local receiver keys.
4. Run byte-parity suites and representative worker benchmarks before restoring or retaining cached mode as default.
5. Validate the reported camera at midnight after progressive enhancement settles and update client architecture documentation.

Rollback selects the existing uncached candidate-neighborhood mode. There is no persisted-data, server-cache, deployment, or payload migration.

## Open Questions

- Does packed `bigint` outperform coordinate strings sufficiently in the rare sparse fallback, or is the simpler representation preferable after measurement?
- Should the reported live payload become an optional diagnostic fixture, or is a compact hermetic fixture reproducing its coordinate and vertical-cell shape sufficient for permanent coverage?
