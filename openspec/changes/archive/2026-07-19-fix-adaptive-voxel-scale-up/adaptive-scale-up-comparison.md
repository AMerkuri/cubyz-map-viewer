## Adaptive Scale-Up Comparison

### Deterministic Fallback Base Wave

Run: `npm run compare:voxel:workers`

Recorded 2026-07-19. The hermetic model releases a four-record focus subset
with 28 ordinary executable base-detail records. The focus subset drains before
the former startup cooldown while the remaining detail keeps the first worker
saturated. All policies use the same records, durations, output capacities,
and scene insertion budget.

| Policy | Target transitions | Base-visible p50/p95/max (ms) | Frame p95 (ms) | Completion identity |
|---|---:|---:|---:|---|
| fixed-1 | fixed | 7552 / 14464 / 14976 | 9.0 | all base records once |
| fixed-2 | fixed | 3808 / 7424 / 7536 | 9.0 | all base records once |
| adaptive-healthy | 1 up / 0 down | 4880 / 8384 / 8608 | 9.0 | all base records once |
| adaptive-unhealthy | 0 up / 0 down | 7552 / 14464 / 14976 | 9.0 | all base records once |

Adaptive healthy reaches target two and has base-visible p95 12.9% slower than
fixed two, within the 25% acceptance limit. The unhealthy replay keeps target
one, proving that the interaction limiter remains effective. The script fails
if adaptive does not reach two or exceeds the fixed-two p95 allowance.

### Live Camera

Live comparison is pending: this workspace has no Cubyz save under
`~/.cubyz/saves/`, so the established camera cannot be started here. Repeat the
same camera in adaptive, fixed-one, and fixed-two modes with healthy frame and
memory signals, then record target maximum, base-visible timing, focus misses,
frame p95, and memory observations in this section.
