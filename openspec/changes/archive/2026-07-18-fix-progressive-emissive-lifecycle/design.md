## Context

Progressive voxel meshing intentionally separates complete base geometry from optional mesh-local emissive attributes. After a base tile is inserted, the same-frame LOD reconciliation correctly removes that fresh tile from the fetch-request set. The current scene integration then treats that missing fetch demand as cancellation for every scheduler record with the tile key, including retained or active enhancement work. Attachment also requires membership in the fetch-request set, so a result that races cancellation is rejected.

One-phase meshing is unaffected because its base result already includes emissive attributes. Runtime glow sprites and high-quality point lights remain independent of the mesh-local emissive path, as confirmed by the progressive Quality screenshot retaining local accents while lacking broad terrain illumination.

## Goals / Non-Goals

**Goals:**

- Allow an eligible progressive enhancement to complete and attach after its base tile has become fresh.
- Preserve existing stale-while-revalidate, refresh-version, and base-mesh-identity safety guarantees.
- Cancel enhancement promptly when its target tile is unloaded, moved to warm cache, replaced, refreshed, or otherwise no longer retained.
- Keep base/fetch cancellation behavior and scheduler priority unchanged for genuinely obsolete work.
- Cover the same-frame base-insert and LOD-reconciliation regression hermetically.

**Non-Goals:**

- Change voxel payloads, server generation, emitter decoding, or WebSocket contracts.
- Alter graphics-preset light budgets or the separate runtime glow and point-light accent system.
- Keep enhancements alive after their loaded base tile leaves the scene lifecycle.
- Rework worker-pool sizing, priority policy, or emissive bake algorithms.

## Decisions

### Separate fetch demand from enhancement-target validity

Base fetch and mesh work remain governed by active fetch demand: a missing or stale tile must still be requested to proceed. Enhancement work instead has a loaded-base target lifecycle. It remains eligible while the loaded tile exists, is fresh for the result refresh version, and has the expected base mesh identity.

The scene integration will use one phase-aware target predicate for both cancellation/reconciliation and result attachment. This avoids the current disagreement where scheduler cancellation and attachment each infer validity from fetch-request membership.

Using the existing active-request set for enhancement was rejected because fresh base tiles are deliberately removed from that set before enhancement can return. Keeping all enhancements unconditionally was rejected because it would allow stale, unloaded, and warm-cached targets to consume worker work or mutate invalid geometry.

### Retain enhancement only through the loaded-tile lifecycle

The loaded voxel map is the enhancement retention lease. A progressive enhancement may survive its base becoming fresh and absent from fetch demand, but it loses eligibility when the matching loaded tile is removed, replaced, made stale, or has a different base mesh identity. Existing refresh version and identity checks remain required at attachment to cover result-transfer races.

Using visibility alone was rejected because a base tile can become fresh before the visibility update and because normal unload grace intentionally retains useful loaded tiles for a short period. Using warm-cache presence was rejected because a cached geometry must not receive a late attribute mutation outside the active scene lifecycle.

### Keep phase-specific cancellation and exact-once ownership accounting

Reconciliation will cancel obsolete base work when fetch demand disappears, while applying the loaded-base retention predicate to enhancement records. Cancellation, worker acknowledgements, error paths, discarded results, reservations, retained compact input, and enhancement output continue to use the scheduler's existing exact-once terminal accounting.

The change does not add another worker message or clone compact buffers. It only corrects when the already-defined enhancement phase is permitted to remain active.

### Test the full hand-off boundary

Add a hermetic regression test that models: eligible progressive base result, scene insertion with a stable base ID, normal fresh-tile LOD reconciliation that clears fetch demand, enhancement completion, and normalized attribute attachment. Complement it with invalidation cases that prove a replacement, unload, stale version, or base-ID mismatch still cancels or rejects the enhancement.

Worker-only parity tests remain valuable but cannot catch this bug because they bypass the main-thread request reconciliation and scene lifecycle.

## Risks / Trade-offs

- [Enhancement uses capacity for an offscreen retained tile] -> Limit eligibility to the existing loaded-tile lifecycle; normal unload grace and priority rules continue to bound and deprioritize it.
- [Late worker result mutates the wrong geometry] -> Require matching refresh version and base mesh identity both before dispatch retention and at attachment.
- [Phase-specific reconciliation leaks retained compact buffers] -> Exercise cancellation, discard, and successful attachment paths in scheduler and pipeline tests, asserting exact-once release.
- [Fetch and enhancement predicates drift later] -> Centralize the enhancement-target predicate and document the separate lifecycles.

## Migration Plan

1. Introduce the phase-aware enhancement target predicate and apply it to reconciliation and attachment.
2. Add the regression and invalidation tests before enabling the behavioral change by default.
3. Update client/runtime documentation to describe the corrected lifecycle.

No server, API, persisted-data, or deployment migration is required. Rollback restores the current progressive behavior by reverting the client-only lifecycle change, though doing so reintroduces the unlit progressive regression.

## Open Questions

None. The existing loaded-tile map, refresh state, and base mesh identity provide the required retention signals.
