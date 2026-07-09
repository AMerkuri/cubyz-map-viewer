## 1. Baseline Metrics And Types

- [x] 1.1 Add focused worker benchmark fields for emissive grid build time, emissive bake time, emissive vertices/quads evaluated or skipped, and emissive output bytes.
- [x] 1.2 Thread any new benchmark fields through `WorkerOut`, benchmark aggregation, and debug display only as needed for comparison.
- [x] 1.3 Update shared worker types so emissive attributes can be represented by compact normalized typed arrays without breaking existing geometry builders.

## 2. Emitter Grid Optimization

- [x] 2.1 Replace per-vertex string-keyed emitter grid lookups with numeric dense local indexing or a bounded sparse numeric fallback.
- [x] 2.2 Preserve emitter radius, candidate ordering, candidate cap, directional transmission, falloff, lambert weighting, hue bias, and clamping semantics.
- [x] 2.3 Add a guard or fallback for pathological emitter-grid extents so dense grid allocation remains bounded.

## 3. Quad Culling And Lazy Allocation

- [x] 3.1 Add conservative quad-level culling so quads outside all emitter influence skip per-vertex emissive accumulation.
- [x] 3.2 Prefer false positives over false negatives so visible emitted light is not dropped at large greedy quads or halo seams.
- [x] 3.3 Lazily allocate per-quadrant emissive output only after the first non-zero emissive contribution is found.
- [x] 3.4 Keep transparent quadrant behavior unchanged with no mesh-local emissive attribute output.

## 4. Compact Emissive Attribute Upload

- [x] 4.1 Encode worker emissive output as normalized integer attributes, preferring `Uint8Array` if visual quality is acceptable and falling back to `Uint16Array` if needed.
- [x] 4.2 Update Three.js geometry upload to pass the normalized flag so the shader continues receiving `vec3` values in `0..1` range.
- [x] 4.3 Confirm material shader patch and block-light strength uniform continue to gate emitted light without shader contract changes.

## 5. Documentation

- [x] 5.1 Update `docs/client-specification.md` for optimized emissive bake behavior, compact attribute representation, and benchmark metric interpretation.
- [x] 5.2 Update `docs/architecture-overview.md` if shared worker output semantics or debug metric contracts change.
- [x] 5.3 Update `docs/server-specification.md` only if benchmark interpretation of server/client timing changes. (No change: server/client timing interpretation is unchanged; the new metrics are client worker-side only.)

## 6. Verification

- [x] 6.1 Run `npm run check`.
- [x] 6.2 Run `npm run check:knip`.
- [x] 6.3 Run `npm run typecheck`.
- [x] 6.4 Run `npm run build` because this changes browser worker and typed-array boundaries.
- [ ] 6.5 Re-run the cached-payload SEASON3 benchmark at `x=794 y=5525 z=51 zoom=67 theta=-87 phi=39 focus=exact` with emissive attributes off and on, recording decode time, emissive bake phase time, worker output bytes, emissive bytes, loaded chunks, and decoded emitters.
- [ ] 6.6 Visually compare emissive output at the benchmark location, especially nighttime or low-light views, to confirm compact normalized attributes do not introduce unacceptable banding or missing light.
