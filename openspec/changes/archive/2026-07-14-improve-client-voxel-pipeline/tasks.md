## 1. Scheduling Foundations

- [x] 1.1 Add typed voxel work identities, stage records, terminal outcomes, view classes, and debug-setting defaults for compact-input, expanded-output, cancellation-checkpoint, and view-margin limits.
- [x] 1.2 Implement pure lexicographic priority comparison for coverage class, view class, projected refinement benefit, distance, LOD, and generation.
- [x] 1.3 Implement pure staged-admission and transition mechanics with job/byte accounting, single-oversized-item progress, reprioritization, and exactly-once terminal release.
- [x] 1.4 Add hermetic tests for priority invariants, input/output saturation, oversized items, errors, and duplicate terminal events.

## 2. Bounded Runtime Pipeline

- [x] 2.1 Route completed voxel HTTP buffers into the prioritized compact-input stage instead of posting every response directly to the worker.
- [x] 2.2 Gate fetch admission on compact-input capacity and gate worker dispatch on active-job and expanded-output capacity while preserving existing HTTP abort and retry behavior.
- [x] 2.3 Integrate worker results with expanded-output byte accounting and release capacity as frame-budgeted scene insertion drains the queue.
- [x] 2.4 Cancel and remove obsolete fetching, compact-input, and scene-ready work when active demand or refresh versions change, retaining final key/version validation for races.
- [x] 2.5 Add hermetic runtime tests for burst backpressure, demand removal, refresh supersession, queue reprioritization, and continued draining after failures.

## 3. Cancellable Worker Jobs

- [x] 3.1 Replace the implicit worker message shape with typed `mesh`, `cancel`, `mesh-result`, `cancelled`, and `error` variants carrying stable job IDs and refresh versions.
- [x] 3.2 Refactor long optimized decode, quad-writing, and emissive-bake phases to yield on a bounded time budget and check active-job cancellation at phase and loop checkpoints.
- [x] 3.3 Ensure observed cancellation releases partial arrays and sends only a cancellation acknowledgement, while cancellation racing final transfer remains safely rejected on the main thread.
- [x] 3.4 Add deterministic worker-mechanics tests for cancellation before allocation, during long phases, before transfer, and after result commitment.

## 4. View-Aware LOD Selection

- [x] 4.1 Implement a pure conservative view classifier using camera direction, FOV, viewport aspect, tile bounds or reference-surface fallback bounds, and separate enter/exit margins.
- [x] 4.2 Apply forward, peripheral, and rear refinement limits to desired voxel LOD while preserving local focus override, render-distance root eligibility, and coarser fallback selection.
- [x] 4.3 Feed view class and projected refinement benefit into coverage-first request priorities and update queued priorities when the camera generation changes.
- [x] 4.4 Add hermetic camera/tree tests for forward detail, peripheral one-level coarsening, rear two-level coarsening, focus override, rotation hysteresis, missing-child fallback, and stationary convergence.

## 5. Loading Diagnostics

- [x] 5.1 Record selection, fetch, worker dispatch/start/completion, result receipt, scene insertion, and first-visibility timestamps on accepted work records.
- [x] 5.2 Extend chunk statistics and the debug HUD with compact-input and expanded-output jobs/bytes, queue waits, request-to-visible timing, and cancellation/discard counts by stage and reason.
- [x] 5.3 Replace nullable benchmark averaging with independent sum/count aggregation and expose valid sample counts for optional server and lighting metrics.
- [x] 5.4 Add tests for stage timing derivation, cancellation accounting, and optional-metric averages with sparse samples.

## 6. Documentation And Validation

- [x] 6.1 Update `docs/architecture-overview.md` with the staged client voxel flow, backpressure boundaries, and cancellable worker protocol.
- [x] 6.2 Update `docs/client-specification.md` with view-aware refinement, coverage-first priority, tuning settings, and loading diagnostics.
- [x] 6.3 Run `npm test && npm run check && npm run check:knip && npm run typecheck` and resolve all failures.
- [x] 6.4 Run `npm run build` to verify the changed browser worker and TypeScript boundaries in production output.
- [x] 6.5 Compare the representative regression camera before and after the change, recording time to coarse coverage, time to settled detail, peak stage bytes, cancellations, loaded counts by LOD, and estimated voxel memory.
