# Extreme Browser Worker Comparison

Measured 2026-07-15 with a fresh browser context, the exact Extreme graphics preset, clean isolated server caches, `VOXEL_QUEUE_LIMIT=64`, and the `SEASON3` save. Server RSS and aggregate process CPU were sampled every 250 ms. The complete trace is in `browser-extreme-measurement.json`.

The comparable workload prefix is the first 72 admitted voxel jobs in each run:

| Workers | Time to 72 admissions | Peak RSS | Peak CPU | Peak queued jobs | Peak running jobs |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 116.9 s | 1,795.0 MiB | 339% | 5 | 1 |
| 8 | 96.9 s | 6,157.2 MiB | 819% | 0 | 6 |

The eight-worker run used 3.4 times the peak RSS and 2.4 times the peak CPU for a 17% reduction in time to the same admission count. It reached the configured 6 GiB safety cutoff after 97.9 seconds, with two jobs still running, so it was terminated before host OOM. It did not build a server queue because up to six jobs ran concurrently and browser-side preparation/fetch scheduling supplied work more slowly than the eight-slot pool could drain it.

The one-worker run continued to the ten-minute observation timeout, reached 4,759.1 MiB over 241 admissions, and still had one running plus three queued jobs. Those later raw peaks are not used for the matched-prefix comparison because the eight-worker run had already been stopped.

Recommended default preset: `VOXEL_WORKERS=1` and `VOXEL_QUEUE_LIMIT=8`. The worker value avoids the 6 GiB multi-worker failure mode, while eight queue entries exceed the measured one-worker peak depth of five and rely on the client's delayed `503` retry path for larger bursts.
