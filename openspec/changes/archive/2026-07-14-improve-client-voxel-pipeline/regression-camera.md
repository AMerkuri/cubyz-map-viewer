## Regression Camera Comparison

Camera:

```text
?x=794&y=5525&z=51&zoom=90&theta=-90&phi=53&focus=exact
```

The controlled current run used the supplied version-3 graphics settings, a
1920x945 content viewport, terrain underlay disabled, biome labels disabled,
and gzip voxel responses. The 1920x945 viewport is material because viewport
height participates directly in screen-space LOD scaling. Both captures used
the same SEASON3 save and camera.

| Metric | Before | Current |
| --- | ---: | ---: |
| Time to first LOD 32 visibility (coarse-coverage proxy) | Not exposed | 1.84 s |
| Time to stable zero loading (2 s idle confirmation) | Not exposed | 22.61 s |
| Peak compact-input bytes | Not exposed; worker input queue was implicit | 50.5 MiB |
| Peak expanded-output bytes | Not exposed; output was not admission-accounted | 3.4 MiB |
| Cancellations | Not exposed | 2 (`inserted:demand-removed`) |
| Discards | Not exposed | 0 |
| Loaded chunks | 76 | 76 |
| Loaded by LOD | 20 / 18 / 12 / 13 / 7 / 6 | 20 / 18 / 12 / 13 / 7 / 6 |
| Estimated total memory | 1236.7 MiB | 1225.4 MiB |
| Active voxel memory | 1100.8 MiB | 1100.8 MiB |
| Voxel warm-cache memory | 135.8 MiB | 124.5 MiB |
| LOD 1 estimated memory | 816.2 MiB | 806.8 MiB |

LOD order in the table is `1 / 2 / 4 / 8 / 16 / 32`. The current compact
input peak may exceed the 32 MiB admission threshold because responses whose
size was unknown at admission are allowed to complete; once the stage crosses
the threshold, further fetch admission stops until it drains.

The baseline benchmark had a mixed server cache (`56` hit / `44` miss), while
the instrumented current run was all hot (`89` hit / `0` miss). Fetch, decode,
and end-to-visible averages are therefore recorded but not treated as a valid
before/after speed comparison. The current run reported 504.9 ms average fetch,
2179.0 ms compact wait, 193.1 ms worker execution, 20.4 ms result transfer,
28.5 ms scene wait, and 10637.4 ms request-to-visible across 87 visible samples.

An initial automation run used a 1905x2053 viewport and selected 48 LOD 1
tiles. Repeating at 1920x945 reproduced the baseline residency exactly,
confirming that result was caused by the documented viewport-height LOD scale
rather than a stationary-selection regression.
