# Candidate Neighborhood Comparison

Run: 2026-07-18

Command: `node --import tsx --test --test-name-pattern "candidate-neighborhood decision matrix" test/voxel/benchmarks/voxel-client.bench.ts`

## Representative Matrix

The paired serial runner warmed both modes, alternated their execution order,
and collected five samples per mode.

| Fixture | Uncached median / p95 | Cached median / p95 | Probe reduction | Cache hit ratio | Peak cache bytes | Byte parity |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Sparse own-only LOD 1 | 51.4 / 60.6 ms | 47.0 / 77.6 ms | 357.0x | 99.7% | 2,788 | yes |
| Cache-bound fallback LOD 1 | 51.6 / 52.9 ms | 52.0 / 52.7 ms | 1.0x | 0.0% | 0 | yes |
| Empty LOD 1 | 39.0 / 43.4 ms | 39.8 / 41.8 ms | 1.0x | 0.0% | 0 | yes |
| Dense halo X-seam west LOD 1 | 6922.7 / 7315.0 ms | 3121.1 / 3259.5 ms | 567.0x | 99.8% | 1,133,452 | yes |
| Dense halo X-seam east LOD 1 | 6936.2 / 6986.0 ms | 3108.3 / 3152.2 ms | 560.2x | 99.8% | 1,226,048 | yes |
| Asymmetric halo Y-seam LOD 1 | 47.8 / 50.1 ms | 40.1 / 41.0 ms | 372.8x | 99.7% | 2,804 | yes |
| Coarse summary LOD 2 | 39.1 / 39.5 ms | 38.1 / 40.8 ms | 88.2x | 98.9% | 2,208 | yes |

The aggregate median time fell from 14,087.8 ms to 6,446.3 ms, a 54.2%
reduction. Aggregate cell probes fell by 8.0x;
the emitter-bearing cached fixtures each exceeded the required 2x reduction,
while empty and forced-bound fallbacks correctly remained at 1.0x. No fixture
regressed by more than 10%, every output was byte-identical, and the largest
accounted cache was 1,226,048 bytes. Final contribution visits remained equal
within each cached/uncached pair, confirming that the cache changes discovery
rather than per-vertex contribution accounting.

## Decision Gate

Every gate passes: aggregate time reduction is at least 25%, aggregate cell
probe reduction is at least 2x, no stable fixture regressed by more than 10%,
all outputs have byte parity, and maximum additional cache storage is below
16 MiB. Cached candidate discovery is therefore the production default.
Explicit `uncached` mode remains available to the worker harness as the
rollback and comparison baseline.

## Live Observation

The fixed LOD 1 live camera completed after the cache selection and reported no
browser errors. Its enabled sample recorded 25 LOD 1 tiles, 91.2 ms base worker
duration, 5681.1 ms selection-to-base-visible, 357.0 ms enhancement worker
duration, 11665.8 ms selection-to-enhanced, 45.2 ms frame-work p50, 100.3 ms
worker-duration p50, and 668,676,915.2 estimated memory bytes. It also recorded
223.7 ms average emissive bake work, 781,414.4 average emissive output bytes,
1.0 ms average grid-build work, and 96 active accent emitters. The disabled
sample recorded zero emissive bake/output and zero active accents. This browser
observation is supplementary and does not replace hermetic byte-parity evidence.
