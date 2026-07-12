## 1. Visibility-Qualified Source Selection

- [x] 1.1 Define a server-side emitted-source eligibility representation that records color, coordinate, and open-face data only after cube, model, or supported semantic source geometry is accepted into the LOD 1 voxel mesh.
- [x] 1.2 Replace raw own-region emitter collection with the visibility-qualified source representation while preserving LOD 1 emitter color, radius, power, and binary record layout.
- [x] 1.3 Apply the same LOD 1 visibility semantics in emitter-summary leaf construction so raw hidden, depth-suppressed, and unrepresented sources are excluded before clustering.
- [x] 1.4 Ensure coarse payload generation derives representatives only from qualified LOD 1 sources and retains them when they reach represented receiving geometry at the requested LOD, including qualified sources whose small model has `lodReplacement = air`.

## 2. Halo Relevance And Cache Validity

- [x] 2.1 Rework LOD 1 halo collection to select only visibility-qualified external sources that can reach generated visible opaque geometry within the configured radius and vertical envelope.
- [x] 2.2 Preserve deterministic edge and corner retention for eligible seam sources when the LOD 1 emitter cap is reached.
- [x] 2.3 Version emitter-summary and persistent voxel-cache identities for source-eligibility and halo-selection semantics, and retain current ETag, compression, coordinate, and binary-record contracts.
- [x] 2.4 Expose or update existing voxel metrics so validation can distinguish qualifying own, halo, and aggregated records from raw metadata scanning.

## 3. Client Presentation And Documentation

- [x] 3.1 Confirm client worker and runtime accent lifecycle consume only the filtered payload records without changing the binary decoder or block-light quality controls.
- [x] 3.2 Update `docs/architecture-overview.md`, `docs/server-specification.md`, and `docs/client-specification.md` to describe represented-source eligibility, visible halo relevance, and coarse-LOD omission behavior.

## 4. Validation

- [x] 4.1 Extend voxel lighting validation coverage to prove that hidden, depth-suppressed, and `lodReplacement = air` sources do not produce LOD 1 or coarse emitter records, mesh illumination, or runtime accents.
- [x] 4.2 Validate a represented emitter near an LOD 1 region edge continues to illuminate eligible receiving geometry across the seam without unrelated full-column halo records.
- [ ] 4.3 Inspect the reported area around `818, 5453, 27` at LODs 1, 2, 4, 8, 16, and 32 to confirm former phantom spots are absent and no source-less coarse representatives remain.
- [x] 4.4 Run `npm run check`, `npm run check:knip`, `npm run typecheck`, and `npm run build`.
