# Large-Save Memory Measurement

Measured 2026-07-15 against the `SEASON3` save with the checked-in 52-request mixed-LOD `dense-spawn-memory-v1` workload, Brotli responses, halo emitters enabled, request concurrency 8, and a 30-second idle observation. The full machine-readable result is in `large-save-measurement.json`.

The captured pre-change diagnostic baseline used one worker with halo disabled and reached about 3.9 GiB peak RSS with 3.1-3.5 GiB settled RSS. The new default-settings run below uses one worker with halo enabled.

| Workers | Cold duration | Cold RSS peak | Post-work RSS | Idle RSS | Cold p50 / p95 latency | Warm p50 / p95 latency |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 (default) | 48.9 s | 1,897.9 MiB | 778.9 MiB | 574.8 MiB | 4,629 / 18,696 ms | 3.2 / 23.7 ms |
| 8 (explicit) | 43.5 s | 5,080.6 MiB | 5,080.6 MiB | 3,380.3 MiB | 2,386 / 31,466 ms | 3.0 / 21.3 ms |

Both cold runs admitted 45 distinct worker jobs with queue capacity 32, zero admission rejections, and zero queued cancellations. Both performed 9,216 cold summary leaf extractions and found 2,110 represented sources. The default run recycled one worker after the completed-job threshold; the eight-worker run recorded no retirements because no individual worker reached a threshold.

All 52 response statuses and compressed payload SHA-256 values matched across cold/warm phases and both worker counts. Each phase produced 43 payloads and 9 empty responses with 14,298,836 wire bytes.

Compared with the pre-change baseline, the default halo-on run reduced observed peak RSS by roughly half and idle RSS by more than 80%. Explicit eight-worker concurrency shortened aggregate cold completion by about 11%, but exceeded the old peak and retained roughly the old settled RSS, confirming that higher worker counts remain an operator-selected memory-throughput trade-off.
