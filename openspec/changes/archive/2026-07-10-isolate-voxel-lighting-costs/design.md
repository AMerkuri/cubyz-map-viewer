## Context

The current block-emissive lighting pipeline uses server-provided own-region plus halo emitter records and client-worker mesh-local light baking. Recent measurements show much slower LOD 1 voxel generation and client loading compared with version 1.1.0, but the available benchmark aggregates fetch, worker decode, and worker output without distinguishing two suspected costs:

- Server halo-emitter collection around each LOD 1 payload.
- Client emissive-attribute baking and transfer for lit voxel quadrants.

The smallest useful experiment is a 2x2 matrix that can be run on the same scene and camera position:

```text
                    Halo off       Halo on
Emissive off        baseline-ish   server halo cost only
Emissive on         client bake     current behavior
```

## Goals / Non-Goals

**Goals:**

- Isolate server halo-emitter cost from client emissive-attribute cost with the smallest debug-only matrix.
- Report enough metrics to compare the four matrix cells without external profiling tools.
- Preserve default visual behavior and production settings.
- Keep the experiment temporary and focused so the follow-up optimization can be based on measured evidence.

**Non-Goals:**

- Optimize halo collection, emissive attribute representation, or worker light baking in this change.
- Change default block-light visuals, radius, intensity, budgets, or LOD behavior.
- Implement coarser LOD emitter aggregation.
- Add a new public route or persisted user-facing feature.

## Decisions

### Decision: Use a 2x2 debug matrix, not a broad performance settings panel

The experiment should expose only two independent diagnostic switches: include halo emitters in server payloads, and bake/upload client emissive attributes. This directly answers whether the regression is server-dominant, client-dominant, or multiplicative.

Alternatives considered:

- Add many lighting tuning controls. Rejected because radius, intensity, budgets, and quality settings would muddy the measurement.
- Profile manually only. Rejected because repeatable in-app counters are needed for consistent comparison across scenes and branches.

### Decision: Keep diagnostics debug-only and default-on for current behavior

The default matrix state should match current behavior: halo emitters enabled and emissive attributes enabled. Diagnostic switches should be reachable only through existing debug/settings infrastructure or development-only configuration, not as a new normal user workflow.

Alternatives considered:

- Change defaults to improve performance immediately. Rejected because this change is for isolation, not optimization.
- Add persistent public controls. Rejected because the controls are temporary diagnostics and could confuse users.

### Decision: Measure phase-specific server and worker costs

Server metrics should distinguish total generation from halo-specific work and include own versus halo emitter record counts. Client metrics should distinguish worker decode/bake time and output bytes, including emissive attribute bytes when possible.

Alternatives considered:

- Rely on existing average decode and total numbers. Rejected because they identify that something is slow but not whether halo generation or emissive output is responsible.
- Use only browser Performance tooling. Rejected because server generation cost is not visible there.

### Decision: Avoid cache pollution where possible

Diagnostic modes that alter payload content, such as disabling halo emitters, should avoid being mistaken for the normal persistent voxel payload. Either route such output through non-persistent diagnostics or include the diagnostic mode in cache identity for any reused generated result.

Alternatives considered:

- Reuse the normal persistent cache regardless of diagnostic mode. Rejected because halo-disabled payloads could contaminate normal rendering or normal payloads could hide the server cost being measured.

## Risks / Trade-offs

- Diagnostic switches may accidentally become product behavior -> Keep names and docs explicitly diagnostic and preserve current defaults.
- Cache behavior can invalidate measurements -> Treat diagnostic mode as part of cache identity or bypass persistent cache for affected measurements.
- Metrics can add overhead -> Keep counters coarse-grained and only add detailed timing around suspected phases.
- The matrix may show both sides are expensive -> That is acceptable; the goal is to identify whether future work needs one optimization or two.
- Existing averaged HUD stats may mix samples from different modes -> Reset or clearly separate benchmark samples when diagnostic mode changes.

## Migration Plan

1. Add diagnostic switches and metrics behind debug settings or development configuration.
2. Run the four matrix cells on the known slow scene with a stable camera/focus state.
3. Record whether server run time, client worker decode time, worker output bytes, or loaded chunk count changes materially in each cell.
4. Use the result to propose or adjust a follow-up optimization change.
5. Rollback is straightforward: remove the diagnostic switches and extra metrics, leaving default lighting behavior unchanged.

## Open Questions

- Should the diagnostic matrix be driven from the client debug UI, server environment variables, query parameters, or a combination?
- Should measurements explicitly bypass persistent voxel caches, or should diagnostic mode be encoded into cache keys for repeatability?
- Which exact HUD fields are enough for comparison without making the debug panel too noisy?
