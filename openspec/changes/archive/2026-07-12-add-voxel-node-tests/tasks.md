## 1. Test Runner And Shared Fixtures

- [x] 1.1 Add aggregate, server, client, contract, and opt-in benchmark npm commands using `node:test` with the existing `tsx` TypeScript loader.
- [x] 1.2 Extract deterministic temporary `.surface` and `.region` fixture writers, fixture block tables, and cleanup lifecycle helpers from the seam validator into test-only modules.
- [x] 1.3 Extract test-only binary emitter decoding, record comparison, seam-vertex collection, and normalized emissive comparison helpers without widening production exports.
- [x] 1.4 Add a minimal cached Node harness that installs the required worker global before dynamically importing and invoking the production client worker mesh builder.

## 2. Server Correctness Tests

- [x] 2.1 Convert the boundary fixture matrix into named server tests for X/Y edges, corners, vertical limits, special neighbors, and dense neighboring emitters.
- [x] 2.2 Add server tests for deterministic payload bytes and record order, unique emitter records, uncapped source membership, cap size, and required-source retention under pressure.
- [x] 2.3 Add adjacent-region server tests for required LOD 1 halo membership and deterministic structural metrics such as external-region parse reuse and payload growth.
- [x] 2.4 Add server tests proving hidden, depth-suppressed, and empty-model emitters are unrepresented while qualified detailed sources remain available to coarse summaries and receiving geometry.

## 3. Client And Contract Tests

- [x] 3.1 Add production client-worker tests for deterministic payload decoding and emissive mesh attributes using controlled generated payloads.
- [x] 3.2 Add client emissive influence tests covering in-radius, out-of-radius, and directionally restricted emitter behavior without a browser or WebGL.
- [x] 3.3 Convert the uncapped and cap-pressure adjacent LOD 1 seam checks into contract tests that match vertices by world position and normal and assert normalized RGB equality within one encoding step.
- [x] 3.4 Convert the adjacent coarse-LOD seam check into a contract test using production summary records and the active emissive attribute's encoding tolerance.
- [x] 3.5 Confirm the capped seam fixture retains required same-edge-distance sources with distinct Y/Z locality on both sides before asserting client-baked seam colors.

## 4. Opt-In Benchmarks

- [x] 4.1 Add reusable serial benchmark sampling and summary helpers with configurable warmup and measured iterations plus minimum, median, and p95 reporting.
- [x] 4.2 Add server benchmarks for baseline generation, dense halo/cap pressure, adjacent-region access, and coarse-summary generation, including payload size and production generator metrics.
- [x] 4.3 Add client benchmarks for baseline decoding, dense emissive baking, and an adjacent seam pair, including output size and available production bake metrics.
- [x] 4.4 Ensure benchmark files are excluded from aggregate correctness tests and report wall-clock measurements without fixed timing failure thresholds.

## 5. Workflow Migration And Documentation

- [x] 5.1 Remove `scripts/validate-voxel-seams.ts` and its npm command only after mapping every existing assertion category to the named test suite; leave `validate:voxel-lighting` unchanged.
- [x] 5.2 Update `docs/architecture-overview.md`, `docs/server-specification.md`, and `docs/client-specification.md` with the test boundaries, commands, seam-color contract, fixture isolation, and benchmark interpretation.
- [x] 5.3 Update contributor guidance to include ordinary correctness tests in the verification workflow and document opt-in benchmark usage separately.

## 6. Verification

- [x] 6.1 Run the focused server, client, and contract correctness commands and confirm all temporary fixtures are cleaned up.
- [x] 6.2 Run the aggregate correctness command and verify it excludes benchmarks and `validate:voxel-lighting`.
- [x] 6.3 Run the server and client benchmark commands and verify warmup, serial sampling, timing summaries, payload/output sizes, and structural metrics are reported.
- [x] 6.4 Run `npm run check && npm run check:knip && npm run typecheck`.
- [x] 6.5 Run `npm run build` to verify the production worker and TypeScript build boundaries.
