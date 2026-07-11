## Repeatable seam validation

Command: `npm run validate:voxel-seams`

The validator creates temporary, valid Cubyz `.surface` and `.region` files and
runs them through the production `generateVoxelMesh` path. Every matrix case is
run uncapped and with 8,192 checkerboard own-region emitters. A second generation
must have byte-identical payload output and identical decoded record order.

Covered placements are X-/X+/Y-/Y+ edges, both horizontal corner polarities,
the lower and upper vertical halo scan extremes, missing/transparent/model
neighbor traversal, dense own records, and a dense neighboring edge. Assertions
cover independently enumerated uncapped halo membership, production payload
ordering, cap size, designated boundary-source retention, record uniqueness
(including corner deduplication), and a nonzero receiving-geometry light proxy.
The proxy applies the worker's radius, smoothstep falloff, open-face masks, and
blocked-axis transmission constants to decoded production records.

### Recorded result

2026-07-11: all 20 fixture/mode runs passed. Uncapped single-source cases
contained one own and one halo record; the dense-both-sides case contained 768
halo records. Every cap-pressure case contained exactly 8,192 records and
retained its designated halo source; the dense-both-sides case retained all 768
eligible halo records.

The pre-change fixed nighttime LOD 1 capture at 2026-07-11T07:10:11Z loaded
526 decoded emitters and selected 96 accents. Across 59 worker samples, mean
emissive bake time was 299.5 ms and mean grid-build time was 3.3 ms. Its
enabled/disabled visual delta was 0.004147 with 42,578 pixels above the 0.02
threshold.

The settled post-change capture at 2026-07-11T07:40:59Z loaded 574 decoded
emitters and selected the same 96-accent budget. Across 59 worker samples, mean
emissive bake time was 195.3 ms and mean grid-build time was 3.6 ms. Despite the
9% higher decoded-emitter count, bake time was about 35% lower. The visual delta
remained effectively unchanged at 0.004115 with 42,210 threshold pixels.

### Limitations

- This is full region-file integration for server collection and retention, but
  the baked-light assertion is a numerical proxy rather than execution of the
  browser worker or a screenshot comparison. The browser worker is not an
  importable Node module, and this change intentionally does not alter client
  runtime code.
- The repeatable harness proves current uncapped byte determinism and expected
  source membership. It cannot reconstruct a byte-for-byte payload from the
  pre-traversability-cache implementation because that implementation is not
  present in the worktree.
- No pre-change cache-miss timing sample is available to prove that halo timing
  improved or did not regress. The mechanism therefore addresses payload
  equivalence for task 4.2, not its historical timing comparison.
