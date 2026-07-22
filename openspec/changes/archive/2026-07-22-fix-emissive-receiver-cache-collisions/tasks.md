## 1. Reproduce Identity Collisions

- [x] 1.1 Add a production-worker regression with equal receiver-cell X/Y, multiple Z cells, and realistic positive world offsets that proves cached and uncached emissive arrays diverge before the fix.
- [x] 1.2 Add equivalent negative-coordinate coverage and assert complete quadrant-array parity rather than aggregate emissive energy.
- [x] 1.3 Add a bounded sparse-grid fixture that places emitters in equal-X/Y, distinct-Z buckets and verifies exact bucket lookup and emitted-light output.

## 2. Correct Spatial Identity

- [x] 2.1 Replace lossy sparse emitter-grid numeric packing with a collision-free, range-checked key representation for all supported cell coordinates.
- [x] 2.2 Derive a bounded dense receiver-cache domain and use verified payload-local linear indices for receiver cells inside it.
- [x] 2.3 Route sparse-grid, out-of-domain, unsafe-index, and cache-capacity cases through deterministic uncached discovery without omitting eligible emitters.
- [x] 2.4 Preserve candidate order, cache accounting, diagnostics, and byte-identical cached-versus-uncached emissive output across existing own, halo, seam, coarse-LOD, and cache-pressure cases.

## 3. Validate Performance And Presentation

- [x] 3.1 Run the serial client voxel benchmark or comparison harness for cached and uncached modes, record parity, bake time, probe reduction, cache entries, and peak cache bytes, and retain uncached production mode if the existing decision gate fails.
- [x] 3.2 Recheck the reported LOD 1 camera at `x=962,y=5491,z=51` at midnight after progressive enhancement settles and confirm the tower receives the payload's local torch light.

## 4. Documentation And Verification

- [x] 4.1 Update `docs/architecture-overview.md` and `docs/client-specification.md` with collision-free emitter-grid identity, payload-local dense receiver caching, and correctness-first uncached fallback behavior.
- [x] 4.2 Run `npm run test:voxel:client` and the affected voxel seam or contract suites.
- [x] 4.3 Run `npm test && npm run check && npm run check:knip && npm run typecheck && npm run build` and resolve all failures.
