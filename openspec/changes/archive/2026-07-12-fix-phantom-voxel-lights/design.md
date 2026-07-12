## Context

The block-emissive pipeline currently identifies emitters from raw Cubyz `.emittedLight` metadata. LOD 1 collection can retain source blocks before the corresponding face or model geometry is accepted into the voxel mesh. Halo collection scans neighboring columns across the full generated vertical span. Coarse summary leaves scan every raw emitted block with a traversable neighbor, then create representatives at weighted centroids even when Cubyz has replaced the source geometry with air at that LOD.

This creates visible glow sprites and mesh-local bright spots without a visible source. The report at `818, 5453, 27` demonstrated both the symptom and a dense source set: the containing LOD 1 payload retained 52 own records and 8,140 halo records, while the coarse payloads retained hundreds of representatives.

## Goals / Non-Goals

**Goals:**

- Make emitted-light records represent source geometry that is actually included in the generated voxel payload.
- Preserve mesh-local light continuity for qualifying sources across LOD and region boundaries.
- Bound halo scanning to geometry that can receive light and invalidate all affected caches.
- Keep the existing voxel binary emitter layout, compression negotiation, and client worker decode contract.

**Non-Goals:**

- Reproduce Cubyz's full voxel light-propagation or occlusion simulation.
- Change Cubyz block definitions or make blocks emit light that do not declare `.emittedLight`.
- Redesign atmosphere lighting, point-light budgets, or the general LOD controller.
- Add a new client/server endpoint or expose raw emitter records as a public API.

## Decisions

### Use generated source geometry as the emitter eligibility authority

Voxel generation will track emitted blocks as candidates while it evaluates faces and model/semantic geometry. It will retain an own-region emitter only after that block contributes represented geometry to the payload. The eligibility record must retain the source coordinate, color, and exposed directions needed by the current binary emitter record.

This uses the same source of truth as the rendered mesh, rather than inferring visibility from raw block metadata or a generic traversable neighbor.

The LOD 1 generator will expose one deterministic represented-source result containing absolute source coordinates, emitted RGB, accepted/open-face data, and requested-LOD applicability. Own payload records, neighbor-owned halo collection, and emitter-summary leaves must consume that same result rather than independently rescanning raw blocks. Halo collection may apply receiving-geometry and radius relevance only after owner eligibility has been established. This single producer guarantees that adjacent payloads begin with the same owner-qualified source set and that coarse summaries cannot drift from LOD 1 visibility semantics.

Alternatives considered:

- Filter only runtime glow sprites. This would leave source-less mesh emissive patches and coarse representatives, so it does not solve the reported behavior.
- Treat every `.emittedLight` block as visible. This is the existing behavior and conflicts with Cubyz LOD replacements and depth-suppressed geometry.
- Render otherwise omitted source models solely to justify their light. This would change the map's LOD geometry rather than fixing lighting provenance.

### Build coarse summaries from visibility-qualified LOD 1 sources

The emitter-summary leaf builder will apply the same visibility eligibility semantics as LOD 1 mesh generation. It will only cluster sources that have represented LOD 1 geometry, and each higher-level summary will continue to derive from those qualified children. Coarse generation retains that qualified source energy when the representative can reach generated opaque geometry at the requested LOD, even if the tiny source model itself resolves to air; representatives with no coarse receiving geometry in range are omitted. This preserves broad distant illumination without reintroducing raw or hidden sources.

Alternatives considered:

- Continue raw scans and discard representatives only on the client. The client cannot authoritatively determine whether server-side source geometry was represented, and stale representatives would still consume payload and bake budget.
- Keep raw sources but snap representatives to nearest coarse mesh. This invents a location and can still illuminate unrelated geometry.

### Restrict halo input to visible receiving geometry and vertical relevance

Halo collection will use the requesting payload's generated opaque geometry and bounded visible vertical range to select external source candidates. A candidate must be visibility-qualified in its owner region and able to reach a receiving surface within the configured radius. The existing deterministic cap and boundary reservation remain, but rank only eligible candidates.

Owner qualification results are cached by source-column and surface signatures in each worker. Cache misses are generated sequentially rather than materializing eight neighboring voxel meshes concurrently, bounding peak memory while retaining deterministic source sets and live-update validity.

This eliminates full-column scanning from unrelated caves and LOD-suppressed content while preserving seam lighting from visible neighboring sources.

Alternatives considered:

- Keep the full vertical scan and only lower the emitter cap. This makes selection less predictable and can still retain unrelated lights while dropping relevant seam lights.
- Remove halos. This avoids the artifact but introduces hard region-boundary lighting seams, violating existing behavior.

### Keep runtime accents downstream of the filtered records

The client worker and `BlockLightRuntimeManager` will continue to decode and manage the existing records. Once server records are source-qualified, glow sprites and optional point lights inherit correct provenance without a binary protocol change. Coarse records remain available only when the payload represents their source geometry.

### Version source-selection semantics in all derived caches

The voxel generator cache version and emitter-summary signature will change with the eligibility and halo-selection semantics. This prevents persisted payloads and summaries produced under raw-source collection from reappearing after deployment. Existing ETag behavior continues to derive from the regenerated payloads.

## Risks / Trade-offs

- [Visibility qualification may omit a light whose source geometry is represented through an unrecognized block shape] -> Reuse and extend the existing cube, model, and semantic shape paths; add targeted validation fixtures for each supported shape family.
- [Shared LOD 1 eligibility can increase summary-build cost] -> Keep generation-local caches and summary persistence; measure source selection separately from meshing with the existing voxel metrics.
- [More selective halos can cause a seam regression] -> Validate adjacent regions with a visible boundary source and retain the deterministic boundary reservation policy.
- [Cache version changes force regeneration] -> Scope invalidation to emitter-summary and voxel-mesh caches; the binary record layout remains unchanged.
- [A source's mesh can be occluded by ordinary camera perspective] -> Eligibility is based on payload representation, not frame-by-frame camera visibility, so panning does not alter payload content.

## Migration Plan

1. Implement source eligibility and halo/summary filtering behind the existing voxel generation path.
2. Bump the emitter-summary signature and voxel cache version before serving changed output.
3. Confirm no stale payloads are reused, then validate LOD 1 through LOD 32 around known former phantom-light coordinates and a deliberate visible seam source.
4. Deploy normally; rollback is a code rollback, after which the previous cache identity regenerates prior behavior.

## Open Questions

- None. The requirement is deliberately payload-representation visibility rather than camera visibility.
