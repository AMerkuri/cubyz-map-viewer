## Context

The project uses Node's built-in test runner with TypeScript loaded through `tsx`. Its current 29-test matrix is hermetic and deep but intentionally concentrated on voxel emitter qualification, binary decoding, emissive baking, and seam continuity. Important orchestration around that path remains unprotected: `VoxelMeshService` coordinates workers and cache epochs, the Express route negotiates compressed representations and validators, the watcher translates filesystem churn into batched invalidations, and the client cancels and refreshes affected terrain and voxel work.

The new tests must remain independent of a user's Cubyz save, external assets, a running server, browser, WebGL, and wall-clock performance budgets. Production behavior is the subject of the tests, not something this change intends to redesign.

## Goals / Non-Goals

**Goals:**

- Protect stale-result rejection, request deduplication, cache identity, compression variants, and hierarchical invalidation in the voxel service.
- Protect the externally observable voxel HTTP contract, including error, empty, conditional, and diagnostic responses.
- Protect filesystem-to-WebSocket and WebSocket-to-client invalidation semantics across positive and negative world coordinates.
- Protect same-LOD terrain seam continuity through the production parsing/build boundary.
- Keep tests deterministic, hermetic, independently selectable, and organized by ownership boundary.
- Keep the aggregate `npm test` command as the ordinary correctness gate while exposing focused commands for investigation.

**Non-Goals:**

- Increasing a numeric coverage threshold or introducing coverage tooling.
- Testing every parser, React component, Three.js frame loop, or visual style in this change.
- Adding browser end-to-end tests, launching the full composition root, or requiring WebGL.
- Changing production HTTP, WebSocket, cache, terrain, or voxel behavior to make an assertion pass.
- Adding fixed latency limits to correctness tests.

## Decisions

### Preserve boundary-oriented suites

Tests will be grouped into server service/API, server watcher, client live-update, and terrain contract suites. Small support modules may provide controlled fakes, temporary save fixtures, request helpers, and semantic mesh comparison, but assertions will exercise production entrypoints rather than copied algorithms.

Alternative considered: create broad unit tests for every helper. That would increase counts quickly but would provide less confidence in the state transitions and cross-module contracts that cause stale or visibly inconsistent worlds.

### Inject controllable collaborators at narrow seams

`VoxelMeshService` tests need control over worker completion and generation outcomes. Prefer constructor-level interfaces or factories for the worker pool and emitter summary service when direct production construction prevents deterministic tests. Route tests will use a small Express application with a fake service implementing the used surface. Watcher path decoding and event scheduling may be tested through exported module-local helpers or injected watcher/timer boundaries, choosing the smallest production change that avoids real sleeps and operating-system watcher races.

Alternative considered: monkey-patch private fields or depend entirely on real worker threads and Chokidar. That would couple tests to implementation details, increase runtime, and make concurrency assertions timing-sensitive.

### Assert state-machine outcomes, not callback volume alone

Service tests will hold a generation promise pending, invalidate its key or global epoch, then release it and assert that the stale result cannot populate the cache. Client update tests will inspect resulting queues, versions, abort state, and requested region identities. Watcher tests will assert deduplicated semantic batches. Route tests will assert status, headers, body, and service invocation options.

Alternative considered: spy-only tests that assert a helper was called. Those can pass while stale data remains committable or while the wrong region identity is refreshed.

### Use explicit coordinate matrices

Path, region, halo, and ancestor tests will include zero, positive, negative, and boundary-adjacent coordinates. Expected identities will be written as fixed tables rather than calculated with the same production helper, so incorrect floor-versus-truncation behavior remains observable.

Alternative considered: random property tests. They could broaden input coverage, but fixed coordinate cases make failures reproducible and directly document the stable X/Y and alignment contracts. Property tests can be added later if the deterministic matrix exposes reusable pure boundaries.

### Test terrain as a server/client contract

The terrain fixture will write adjacent synthetic `.surface` tiles whose shared edge and gutter produce observable normals. It will pass responses through production terrain parsing/building and compare matching border positions and normals. A changed source tile will also demonstrate that the neighboring tile is a gutter dependent and must be invalidated/rebuilt.

Alternative considered: test only raw terrain payload gutters. That would miss client indexing, coordinate, and normal-generation regressions that still create visible seams.

### Keep one default correctness command with focused groups

`npm test` will include the existing voxel suites and the new core suites. Focused scripts will separate server service/API, watcher, client runtime, and terrain contract failures. No suite will enforce machine-dependent timing. Contributor documentation will explain the suite boundaries and hermetic requirements.

Alternative considered: leave new suites outside `npm test`. That would make important runtime guarantees opt-in and likely allow regressions through routine verification.

## Risks / Trade-offs

- [Dependency injection broadens production types solely for tests] -> Introduce only narrow structural interfaces at existing ownership boundaries and keep helpers unexported unless another module imports them.
- [The aggregate suite becomes too slow] -> Prefer controlled fakes for orchestration, reuse compact deterministic fixtures, and keep real worker generation only where it proves a production contract.
- [Fake service route tests drift from the real service] -> Type the fake against the production method surface and retain separate production service tests for cache and compression behavior.
- [Timer tests become flaky] -> Avoid elapsed-time assertions; use zero-delay batching, explicit flush seams, or Node mock timers where compatible.
- [Terrain comparisons become snapshot-heavy] -> Compare semantic border positions, indices, normals, and gutter-dependent refresh identities rather than entire binary payloads or Three.js objects.
- [Tests reveal existing negative-coordinate defects] -> Treat failures as product correctness issues, document the intended stable coordinate behavior, and make the smallest production correction within this change.
- [Internal refactoring accidentally changes a shared contract] -> Run the complete voxel matrix, typecheck, Biome, Knip, and build; update architecture and side-specific documentation if implementation uncovers a real contract change.
