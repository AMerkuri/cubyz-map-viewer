## Worker Pool Comparison

Run `npm run compare:voxel:workers` to replay the same deterministic `spawn-overview`, `settled-focus`, and `ridge-pan` workload for each policy. The harness uses phase output reservations, the production adaptive target reducer, fixed synthetic worker durations and outputs, one scene insertion per frame, and desktop/mobile-class frame and memory assumptions.

These are reproducible hermetic modeled results, not manual browser or WebGL measurements. They compare scheduling mechanics without claiming device performance. Task 7 manual validation remains separate.

<!-- comparison-results -->

Recorded 2026-07-17:

| Class | Mode | Frame p95 (ms) | Oldest focus (ms) | Base-visible p95 (ms) | Scene backlog max | Expanded peak (MiB) | Memory estimate peak (MiB) |
|---|---:|---:|---:|---:|---:|---:|---:|
| desktop | fixed-1 | 11.1 | 2456 | 12816 | 0 | 4.5 | 313.6 |
| desktop | fixed-2 | 11.1 | 560 | 5088 | 1 | 8.8 | 386.0 |
| desktop | fixed-4 | 11.1 | 360 | 872 | 1 | 17.1 | 386.0 |
| desktop | adaptive | 11.1 | 1768 | 11248 | 1 | 8.8 | 386.0 |
| mobile | fixed-1 | 16.1 | 2456 | 12816 | 0 | 4.5 | 313.6 |
| mobile | fixed-2 | 16.1 | 560 | 5088 | 1 | 8.8 | 386.0 |
| mobile | fixed-4 | 16.1 | 360 | 872 | 1 | 17.1 | 386.0 |
| mobile | adaptive | 16.1 | 2456 | 12816 | 0 | 4.5 | 313.6 |

The desktop adaptive policy reaches two workers in this replay but remains deliberately slower than fixed four because increases require sustained demand and cooldown. The mobile adaptive profile remains at one under the modeled frame/memory pressure. Fixed four demonstrates latency potential and its larger in-flight expanded-byte exposure, but exceeds the production mobile profile maximum and is comparison-only.
