## 1. Baseline And Encoding Decisions

- [x] 1.1 Capture fixed nighttime comparison scenes at LOD 1, 2, 4, 8, 16, and 32 and record initial brightness, footprint, emitter-count, payload-byte, emissive-grid, and emissive-bake baselines.
- [x] 1.2 Define documented visual acceptance bands for important-cluster luminance and illuminated footprint relative to LOD 1, including upper bounds that reject coarse overbrightening.
- [x] 1.3 Select and document fixed-point power quantization, maximum representative power, maximum world-space radius, client gain compression, and per-summary representative limits using the baseline scenes.
- [x] 1.4 Benchmark blocking versus deferred cold summary construction and select a bounded request behavior for missing LOD 1 summary nodes.

## 2. LOD 1 Emitter Summary Hierarchy

- [x] 2.1 Add server-side summary types and centralized summary/version constants for additive RGB power, weighted centroid, source count, exposure, extent, and signatures.
- [x] 2.2 Implement deterministic LOD 1 leaf extraction from aligned source columns, including emitted-light metadata, neighboring exposure checks, and fully enclosed source filtering.
- [x] 2.3 Implement target-LOD spatial clustering that combines child clusters while retaining additive RGB power, weighted position, source extent, and deterministic priority ordering.
- [x] 2.4 Implement bounded parent composition for LOD 2, 4, 8, 16, and 32 nodes from four aligned child summaries.
- [x] 2.5 Add generation-local promise reuse and memory caching so concurrent requests do not parse or build the same summary node repeatedly.
- [x] 2.6 Add versioned persisted summary encoding and validation under the existing save-specific project cache namespace.
- [x] 2.7 Handle missing, malformed, and stale summary files by safely rebuilding or returning the selected bounded cold-path result.

## 3. Server Voxel Integration And Invalidation

- [x] 3.1 Replace same-LOD coarse emitter discovery in voxel generation with the summary node matching the requested coarse region footprint while leaving LOD 1 detailed and halo paths unchanged.
- [x] 3.2 Convert retained summary clusters into bounded payload representatives with normalized hue, source-equivalent power, weighted position, conservative exposure, and capped world-space radius.
- [x] 3.3 Include summary signatures, source strategy, clustering constants, power/radius semantics, and block emitted-light metadata in persisted summary and voxel mesh cache identity.
- [x] 3.4 Invalidate a changed LOD 1 leaf, its aligned LOD 2 through LOD 32 summary ancestors, and dependent in-memory and persisted coarse voxel payloads.
- [x] 3.5 Extend live terrain-update handling so loaded and warm coarse tiles covering an invalidated LOD 1 source region become stale and refresh through `VoxelMeshService`.
- [x] 3.6 Remove the obsolete same-LOD coarse aggregation path after the LOD 1 summary path is validated.

## 4. Emitter Payload Metadata

- [x] 4.1 Extend the versioned voxel binary header with an optional emitter-metadata section whose entry count and bounds can be validated independently.
- [x] 4.2 Encode fixed-size power and world-radius metadata for coarse representatives while omitting the section for all-default LOD 1 detailed and halo records.
- [x] 4.3 Update server payload metrics, cache readers, worker protocol types, and route response diagnostics for the new metadata bytes and representative ranges.
- [x] 4.4 Decode the optional metadata in the client worker, defaulting absent entries to power `1` and radius `12`, and reject malformed count or offset combinations safely.
- [x] 4.5 Thread decoded representative power and radius through worker output, pending voxel items, loaded tile ownership, memory accounting, and runtime emitter types.

## 5. Radius-Aware Client Lighting

- [x] 5.1 Apply the selected monotonic bounded power compression in per-vertex emissive accumulation without changing default LOD 1 contribution.
- [x] 5.2 Replace fixed-radius center-cell emitter lookup with a bounded radius-aware spatial index that conservatively covers each representative influence area.
- [x] 5.3 Update quad-level emissive culling and candidate deduplication for variable-radius records while preserving false-positive preference and deterministic candidate caps.
- [x] 5.4 Apply separately bounded representative power/radius scaling to runtime glow accents and optional point lights while keeping mesh-local illumination primary.
- [x] 5.5 Verify quality `0`, disabled emissive attributes, transparent geometry exclusions, model-quad reduction, and legacy/default emitter records retain existing behavior.

## 6. Diagnostics And Documentation

- [x] 6.1 Add summary cache hit/miss, build time, leaf parse, raw LOD 1 source, retained representative, and capped-cluster metrics to server generation and benchmark diagnostics.
- [x] 6.2 Add encoded power/radius range, metadata-byte, radius-aware grid-build, candidate, evaluated-quad, and culled-quad metrics to client diagnostics where needed for budget validation.
- [x] 6.3 Update `docs/architecture-overview.md` with the LOD 1 summary hierarchy, optional emitter metadata contract, invalidation flow, and client interpretation.
- [x] 6.4 Update `docs/server-specification.md` with summary generation/storage, coarse payload production, cache signatures, invalidation, route metrics, and cold-build behavior.
- [x] 6.5 Update `docs/client-specification.md` with power compression, variable-radius indexing/culling, runtime accent behavior, defaults, and diagnostic interpretation.

## 7. Validation

- [ ] 7.1 Regenerate cold and warm coarse payloads for representative sparse, dense, mixed-color, boundary, and no-emitter scenes and verify deterministic summary and payload output.
- [x] 7.2 Confirm an LOD 1 emitter absent from same-LOD coarse chunks remains represented at the appropriate coarser LODs.
- [ ] 7.3 Change, add, and remove LOD 1 emitters and verify leaf/ancestor summary invalidation, voxel cache invalidation, and visible loaded-tile refresh.
- [ ] 7.4 Capture every fixed transition scene at all supported LODs and verify brightness, dominant hue, and footprint stay within the documented lower and upper acceptance bands.
- [ ] 7.5 Benchmark cold summary construction, warm summary reuse, payload bytes, metadata bytes, emissive grid time, emissive bake time, candidate counts, and quad culling against the recorded budgets.
- [x] 7.6 Run `npm run check && npm run check:knip && npm run typecheck`.
- [x] 7.7 Run `npm run build` to verify the server worker, browser worker, binary payload, and TypeScript boundaries.
