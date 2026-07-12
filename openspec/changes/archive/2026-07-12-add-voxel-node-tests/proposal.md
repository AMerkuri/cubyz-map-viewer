## Why

Voxel lighting regressions are currently guarded by standalone validation scripts that provide coarse pass/fail output and are not part of a reusable test workflow. Hermetic Node test-runner coverage is needed to isolate server generation failures, client emissive-bake failures, and cross-boundary contract failures without requiring a running viewer or real Cubyz world.

## What Changes

- Add a Node test-runner workflow for server voxel generation and production client-worker behavior using generated temporary world fixtures.
- Convert the existing voxel seam validation into named server, client, and server/client contract tests, including exact adjacent seam vertex-color comparisons under normal, cap-pressure, and coarse-LOD conditions.
- Add opt-in server-generation and client emissive-bake benchmarks with warmup, repeated samples, timing summaries, payload metrics, and deterministic structural assertions.
- Replace the `validate:voxel-seams` contributor command with test commands while leaving `validate:voxel-lighting` unchanged and outside this change.
- Document the test boundaries, commands, fixture model, benchmark interpretation, and the distinction between hermetic seam tests and real-world visual validation.

## Capabilities

### New Capabilities
- `voxel-node-test-suite`: Hermetic Node-runner correctness, contract, and benchmark coverage for server voxel generation and client emissive baking.

### Modified Capabilities

None.

## Impact

- Affects `package.json`, test-only TypeScript files and helpers, and the current `scripts/validate-voxel-seams.ts` validation harness.
- Exercises production server services and the exported production client voxel worker without changing their runtime contracts.
- Changes the contributor verification workflow and therefore requires updates to the relevant client/server documentation and architecture overview.
- Does not alter `validate:voxel-lighting`, require Playwright, launch the application, access a real save, or add a runtime dependency.
