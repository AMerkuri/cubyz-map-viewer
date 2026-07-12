## Context

`scripts/validate-voxel-seams.ts` currently creates synthetic `.surface` and `.region` files, calls the production server voxel generator, decodes the resulting payload through the production client voxel worker, and performs many assertions inside one standalone process. It provides valuable end-to-end seam coverage, but failures are grouped into a monolithic command, fixture and payload helpers are not reusable, and there is no standard test or benchmark entrypoint.

The useful seam path is already hermetic: it needs neither HTTP nor a real save, and the client worker's exported mesh builder can execute under Node after installing a minimal worker-global shim. The visual lighting capture script is different because it requires a running application, Chromium, and world-specific data; it remains outside this change.

## Goals / Non-Goals

**Goals:**

- Establish Node's built-in test runner as the project test framework, with TypeScript loaded through the existing `tsx` dependency.
- Provide independently selectable server, client, and cross-boundary voxel correctness tests.
- Preserve the strongest existing seam invariant by comparing production client-baked emissive colors for matching vertices on both sides of an adjacent-region boundary.
- Reuse deterministic temporary world fixtures across correctness tests and opt-in benchmarks.
- Add reproducible server-generation and client emissive-bake benchmark reports without introducing flaky default timing gates.
- Replace the standalone seam-validation workflow and document the new contributor commands.

**Non-Goals:**

- Moving `validate:voxel-lighting` into the test runner or changing that command.
- Launching Express, Vite, a browser, WebGL, or Playwright in the new tests.
- Reading a user's Cubyz save or depending on Cubyz assets.
- Changing the voxel payload, generation algorithm, client lighting algorithm, or runtime API.
- Treating machine-dependent wall-clock thresholds as ordinary correctness assertions.

## Decisions

### Use `node:test` with the existing TypeScript loader

Tests will use `node:test` and `node:assert/strict`, launched through Node with `tsx` registered as the TypeScript loader. This avoids a new test-framework dependency and keeps ESM imports consistent with production. Package commands will expose an aggregate correctness run plus focused server, client, and opt-in benchmark runs.

Alternative considered: add Vitest. It offers richer test APIs, but the requested Node runner is sufficient and avoids another configuration and dependency surface.

### Separate test-only fixtures and decoders from production modules

The temporary save writer, block tables, payload emitter decoder, seam-vertex collector, and worker harness will live in test support modules. Production exports will not be widened solely for tests. Each test owns a temporary root and removes it during teardown, while immutable fixture definitions can be shared.

Alternative considered: retain one converted seam test file. That minimizes movement but preserves a large, coupled harness and prevents focused failure reporting and benchmark reuse.

### Test three explicit boundaries

Server tests will assert deterministic bytes, stable and unique emitter records, source qualification, cap behavior, adjacent halo membership, coarse aggregation, and generator statistics. Client tests will feed controlled payloads to the production worker mesh builder and assert deterministic decoding and emissive output. Contract tests will generate adjacent server payloads, build both through the production client worker, match seam vertices by world position and normal, normalize compact emissive attributes, and require channel equality within one encoding step.

The contract matrix will retain uncapped and capped LOD 1 fixtures and the adjacent coarse-LOD fixture. It will include required cross-boundary sources and same-edge-distance sources with distinct Y/Z locality so cap selection regressions remain observable.

Alternative considered: assert only equivalent server emitter records. That is cheaper but cannot catch client grid, coordinate, normalization, or bake regressions that produce visible seams despite valid payloads.

### Run the browser worker implementation directly under Node

A test helper will install the minimum `self` compatibility required before dynamically importing the worker module, cache that import, and call its exported `buildMeshArrays` function. Tests will not simulate worker messaging or instantiate a browser Worker because the behavior under test is payload decoding and mesh baking, not transport wiring.

### Keep benchmarks opt-in and distinguish structural budgets from timing

Benchmark cases will use the same deterministic fixtures, perform warmup iterations, run measured iterations serially, and report sample count, minimum, median, and p95 timing together with payload size and available production metrics. Server cases will cover baseline generation, dense halo/cap pressure, adjacent-region access, and coarse summaries. Client cases will cover baseline decoding, dense emissive baking, and an adjacent seam pair.

Default correctness tests may enforce deterministic structural invariants such as emitter caps, payload size expectations, external-region parse reuse, and nonzero seam coverage. Wall-clock benchmark results will be observational rather than hard pass/fail budgets because shared development and CI machines are not stable enough for reliable millisecond thresholds.

Alternative considered: include benchmarks in the default test command with fixed latency limits. That would make routine verification slow and prone to environmental failures unrelated to code regressions.

### Replace only the seam validation command

The `validate:voxel-seams` script and command will be removed after its assertions are represented by named tests. `validate:voxel-lighting` remains unchanged. Contributor documentation will identify the new commands and distinguish hermetic binary/worker coverage from environment-dependent visual capture.

## Risks / Trade-offs

- [The worker module assumes browser globals beyond `self`] -> Keep the compatibility shim minimal, import dynamically after setup, and run the production build/typecheck boundary to detect drift.
- [Parallel tests contend for CPU or share worker-global state] -> Give fixtures isolated temporary roots, cache only the stateless worker module, and run benchmark measurements serially.
- [Splitting the validator accidentally drops an assertion] -> Map every existing fixture and assertion category to an explicit task and compare the converted suite against the original validator before deletion.
- [Wall-clock benchmark output is mistaken for a stable performance budget] -> Label timing as observational, report structural metrics alongside it, and keep benchmarks outside the default correctness command.
- [Server/client contract tests blur ownership] -> Keep focused unit-facing suites and place seam-color tests in an explicit contract group that documents both production boundaries.
- [Synthetic fixtures diverge from real data] -> Continue using the actual Cubyz file parsers, server generator, binary payload, and production worker; retain the separate real-world lighting harness for visual investigation.
