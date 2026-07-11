## Context

The current coarse emitter path discovers sources while traversing same-LOD voxel chunks, groups them into `4x4x4` coarse-cell clusters, and emits one weighted-average RGB record per retained cluster. This is inexpensive and uses the existing 16-byte emitter layout, but it has two independent losses:

1. Cubyz coarse chunks may no longer contain emitting blocks that exist at LOD 1, so those sources never become aggregation candidates.
2. A retained cluster's accumulated strength and source count are used for ranking but discarded from the payload. The client consequently renders the representative with the same fixed power and 12-block radius as one LOD 1 source.

The fixed radius also becomes smaller than the aggregation footprint at LOD 4 and above because a `4x4x4` cluster spans `4 * lod` world blocks. Increasing only the global client intensity cannot recover absent sources and cannot affect surfaces outside the fixed radius.

Directly scanning every covered LOD 1 column for each request is not viable. A LOD 32 voxel region covers `32x32` LOD 1 region columns, so an uncached implementation could parse 1024 columns for one coarse payload. The source data therefore needs a reusable bounded hierarchy independent of mesh traversal.

## Goals / Non-Goals

**Goals:**

- Make LOD 1 emitted-light sources eligible for representation at every supported coarser voxel LOD even when Cubyz coarse chunks discarded those blocks.
- Preserve bounded aggregate color power, weighted location, and source footprint across LOD transitions.
- Avoid repeated raw LOD 1 scans by building deterministic memory and persisted summary nodes aligned to voxel region footprints.
- Preserve current LOD 1 emitter, halo, and visual behavior.
- Keep coarse payload size, server generation work, client grid/bake work, and runtime accents bounded and measurable.
- Invalidate summaries and dependent voxel payloads when source blocks, exposure, metadata, or aggregation semantics change.

**Non-Goals:**

- Reproduce Cubyz light propagation exactly.
- Preserve every LOD 1 source as an individual record at all distances.
- Guarantee physically exact lumen conservation after display compression and per-channel clamping.
- Add dynamic runtime lights as the primary coarse illumination mechanism.
- Build a general-purpose world database or background indexing daemon.

## Decisions

### Decision: Build a persisted hierarchical emitter-summary cache from LOD 1 leaves

Introduce an emitter-summary service under the server service layer. A leaf summary is aligned to one LOD 1 voxel region column and derives exposed emitters from its LOD 1 `.region` files plus the bounded neighboring cells needed to determine source exposure. Parent summaries correspond to the existing supported LOD footprints and combine four aligned child summaries:

```text
                         LOD 8 summary
                    /        |        \
              four LOD 4 child summaries
                  /          |          \
              LOD 2 summaries ...
                  /          |          \
              LOD 1 source-column leaves
```

Each node stores a bounded deterministic list of clusters plus source/signature metadata. Nodes are cached in memory and persisted under the existing project voxel-cache namespace. A coarse voxel generation request asks for the summary node matching its `(lod, regionX, regionY)` footprint and does not scan raw LOD 1 columns when a valid node exists.

Leaf and parent limits prevent summary construction from growing with the unbounded raw source count. When a node exceeds its limit, deterministic spatial grouping and strength ordering combine or discard the weakest clusters while retaining total pre-compression power in the representatives that survive.

Alternatives considered:

- Scan every covered LOD 1 region for every coarse request. Rejected because generation cost grows to 1024 LOD 1 columns for one LOD 32 tile.
- Continue using same-LOD chunks and apply a global LOD multiplier. Rejected because no multiplier can recover source locations or colors already absent from coarse data.
- Build all summaries eagerly at server startup. Rejected because startup cost and unused-world indexing would be excessive.
- Add a database. Rejected because deterministic cache files are sufficient and avoid a new runtime dependency.

### Decision: Summaries retain additive RGB power, centroid, and extent

Each summary cluster tracks additive linear RGB sums, a luminance-weighted world-space centroid, source count, and a conservative source extent. Parent nodes merge child clusters in world-space cells sized for the target LOD. The payload representative derives:

- hue/color from normalized additive RGB;
- source-equivalent power from the scale removed during color normalization;
- position from the weighted centroid;
- influence radius from the LOD 1 base radius plus bounded source extent;
- exposure from conservative source/open-face information suitable for a merged representative.

The encoded power remains an uncompressed source-equivalent value up to a configured payload cap. Display compression is a client presentation decision, allowing diagnostics to distinguish source aggregation from rendering tone mapping.

Alternatives considered:

- Store only source count. Rejected because equally sized clusters can have very different RGB strength.
- Multiply average RGB bytes on the server. Rejected because saturated channels cannot encode substantial cluster power and the lost scale cannot be recovered by the client.
- Use LOD alone to choose radius. Rejected because sparse and spatially broad clusters at the same LOD require different footprints.

### Decision: Add optional coarse-emitter metadata without expanding ordinary LOD 1 records

Bump the versioned voxel payload semantics and add an optional parallel metadata section for emitter power and world-space radius. The existing 16-byte position/RGB/flags records remain unchanged. When the metadata section is absent, every record decodes with the current defaults: power `1` and radius `12`. Coarse payloads include one fixed-size metadata entry per emitter; LOD 1 payloads omit the section unless a future feature requires non-default values.

The initial metadata entry uses bounded fixed-point power and integer world-radius fields. Exact quantization ranges and cache signatures are centralized with the aggregation constants. This avoids a 25% record-size increase for all detailed and halo LOD 1 emitters while making coarse semantics explicit.

Alternatives considered:

- Infer power and radius from tile LOD in the client. Rejected because actual cluster count, strength, and spread vary within one LOD.
- Expand every emitter record from 16 to 20 bytes. Rejected because detailed LOD 1 and halo records need only default metadata.
- Duplicate colocated records to simulate power. Rejected because it consumes record/candidate/accent budgets, interacts poorly with coordinate-based runtime identity, and still cannot encode footprint.

### Decision: Apply monotonic bounded power compression and per-emitter radius in the worker

The worker decodes power and radius into each emitter record. LOD 1 defaults continue through the existing fixed-radius calculation unchanged. For coarse representatives, the pre-clamp contribution uses a monotonic sublinear power curve, initially square-root compression with a configurable maximum gain, followed by the existing per-channel contribution clamp. This keeps a stronger cluster brighter than a weaker cluster without allowing source count to scale brightness without bound.

The emitter spatial index becomes radius-aware. Rather than placing each emitter only in its center cell and searching a fixed `3x3x3` neighborhood, each bounded emitter is indexed into the base grid cells intersecting its influence bounds. Vertex accumulation queries the containing cell and deduplicates candidates where required. Quad culling queries the same conservative radius-aware index, preserving false-positive preference and the existing candidate cap.

Runtime glow accents use the representative power/radius only through separate bounded scale and opacity curves. Point lights remain optional and capped. This prevents mesh-local and runtime effects from interpreting one representative inconsistently while retaining mesh-local illumination as primary.

Alternatives considered:

- Increase only `VOXEL_EMITTED_LIGHT.intensity` by LOD. Rejected because it cannot extend the influence area and rapidly reaches the existing `0.66` clamp.
- Use the largest loaded radius as one global grid-cell size. Rejected because one broad source would enlarge candidate cells for every source and reduce culling effectiveness.
- Remove contribution clamps. Rejected because dense clusters would wash receiving surfaces to white.

### Decision: Invalidation follows summary ancestors and dependent coarse payloads

Summary identity includes the LOD 1 column signatures, block emitted-light metadata signature, exposure/summary algorithm version, cluster limits, power/radius quantization, and child summary signatures. A changed LOD 1 source column invalidates its leaf and each aligned ancestor at LOD 2, 4, 8, 16, and 32. Voxel mesh cache keys include the matching summary signature, so a coarse payload cannot reuse representatives from stale source data.

Live terrain updates evict affected in-memory and persisted summary nodes and mark loaded or warm coarse voxel tiles whose footprints contain the source column stale. Existing route handling continues through `VoxelMeshService`; the summary service is consumed by voxel generation rather than exposed as a separate HTTP route.

Alternatives considered:

- Depend only on cache-version bumps. Rejected because live source updates would remain stale until restart or manual cache clearing.
- Invalidate every coarse voxel payload. Rejected because aligned ancestor calculation provides a bounded exact dependency set.

### Decision: Validate visual continuity and cost together

Diagnostics add summary cache/build timing, leaf parse counts, summarized LOD 1 source count, retained representative count, and encoded power/radius ranges. Existing emitter bytes, emissive grid/bake time, and evaluated/culled quad metrics remain the client cost measurements.

Visual validation uses fixed nighttime camera URLs and captures each scene while forcing one supported LOD at a time. Before final tuning, the implementation records acceptance bands for luminance and illuminated footprint relative to LOD 1. Passing requires avoiding both progressive dimming and coarse overbrightening; record-count or source-energy metrics alone are not accepted as visual proof.

### Dedicated LOD capture methodology

`minRenderedVoxelLod` defines only the finest permitted level; it does not force a uniform level across the visible view. A dedicated comparison capture therefore intercepts the browser request to `/api/world/chunk-index` and retains only entries whose `lod` equals the target level. This makes those entries the only voxel roots and prevents the normal distance scheduler from retaining LOD 8, 16, or 32 fallback tiles around a LOD 4 focus.

Each enabled/disabled pair MUST use a fresh browser context, the same viewport and graphics settings, and a 30-second settle period. The tracked `npm run validate:voxel-lighting` harness seeds those settings before navigation, filters `/api/world/chunk-index` to the target LOD, saves paired canvas images plus JSON metadata, and calculates grayscale absolute-delta mean and 2% footprint. The enabled state uses balanced block-light quality and worker emissive attributes; the disabled state sets both block-light quality and worker emissive attributes to `0` so runtime accents and mesh-local illumination are absent. The harness MUST parse the `Loaded by LOD` HUD row before capture and reject the run unless the target level has one or more loaded tiles and every other level has zero. The current dedicated spawn comparison scene is:

```text
http://192.168.50.82:5173/?x=794&y=5525&z=51&zoom=500&theta=-90&phi=53&focus=exact
```

With this method, the valid full-light-off LOD 4 run loaded 20 tiles in both states, with no other level loaded. Its enabled-minus-disabled grayscale delta mean was `0.008998`, with a `66,724`-pixel footprint above the 2% threshold. The superseded `0.009556` / 69,227-pixel comparison used an incomplete light-off reference with active accents and is not transition evidence. This scene-specific measurement is retained separately from the original all-LOD transition baseline.

## Risks / Trade-offs

- Hierarchical summaries add persistent cache complexity and cold-build work -> Build lazily, persist deterministic nodes, expose cache/build metrics, and cap work per node.
- A cold high-LOD request can recursively require many missing leaves -> Reuse child promises, bound concurrent parsing, and allow summary construction to compose persisted children; benchmark worst-case cold behavior before enabling broad warmup.
- Exposure calculated at LOD 1 boundaries can require neighboring source reads -> Share generation-local leaf loads and include neighbor signatures needed by exposure semantics.
- Conservative extent can merge separated lights into one broad pool -> Use target-LOD spatial cells, cap radius, and prefer multiple representatives while budget remains.
- Power compression can still overbrighten dense clusters -> Keep monotonic sublinear gain, existing per-channel clamps, and upper visual acceptance bands.
- Radius-aware indexing can increase grid memory and build time -> Cap radius, bound occupied cells per representative, retain candidate caps, and report grid metrics.
- Summary invalidation can fan out across loaded coarse tiles -> Invalidate only the six aligned ancestor footprints and let normal voxel scheduling refresh visible tiles.
- Optional payload metadata complicates decoding -> Version the header explicitly, require metadata count to match emitter count, reject malformed bounds safely, and preserve absent-section defaults.
- Coarse source accents can become visually oversized -> Tune accent scaling independently and keep sprites/point lights secondary to baked illumination.

## Migration Plan

1. Add summary storage and diagnostics behind the new summary/cache signature while leaving current coarse payload generation available during development.
2. Add the versioned optional emitter metadata section and client decoding with default semantics for payloads without metadata.
3. Switch coarse generation to LOD 1 summary nodes and bump voxel generator/payload cache identities so old same-LOD coarse payloads are not reused.
4. Enable radius-aware client baking and bounded runtime accent interpretation.
5. Validate fixed LOD transition scenes and performance budgets before removing the old same-LOD aggregation path.
6. Update architecture, server, and client documentation with the final format, cache, invalidation, and rendering behavior.

Rollback consists of reverting the generator/payload version and coarse source strategy. Versioned summary and voxel cache files then become unreachable and may be removed as cache data; no save-world data migration is required.

## Validation Baseline And Initial Limits

The initial fixed transition scene uses the `SEASON3` save at viewer time `0.00 h`, a `1440x960` viewport, Balanced atmosphere and block lights, and this exact camera URL:

```text
http://127.0.0.1:5173/?x=794&y=5525&z=35&zoom=170&theta=179&phi=17&focus=exact
```

Captures force each supported minimum voxel LOD in turn. For every LOD, an otherwise identical block-lights-disabled capture provides the ambient reference. `delta mean` is the mean grayscale absolute difference between the enabled and disabled captures. `footprint` counts pixels whose grayscale difference exceeds 2% of display range. The payload and worker figures below are warm-cache client diagnostic averages; they are cost baselines rather than per-tile format limits.

| Focus LOD | Decoded emitters | Avg encoded payload | Avg emissive bytes | Grid build | Bake | Delta mean | Footprint | Footprint vs LOD 1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 425 | 453.6 KB | 653.6 KB | 0.2 ms | 64.0 ms | 0.038504 | 353,482 px | 100.0% |
| 2 | 3 | 96.3 KB | 5.1 KB | 0.0 ms | 1.0 ms | 0.000149 | 3,525 px | 1.0% |
| 4 | 0 | 54.5 KB | 0 B | 0.0 ms | 0.0 ms | 0 | 0 px | 0% |
| 8 | 0 | 39.7 KB | 0 B | 0.0 ms | 0.0 ms | 0 | 0 px | 0% |
| 16 | 0 | 39.0 KB | 0 B | 0.0 ms | 0.0 ms | 0 | 0 px | 0% |
| 32 | 0 | 49.0 KB | 0 B | 0.0 ms | 0.0 ms | 0 | 0 px | 0% |

This reproduces the reported LOD 2 loss and shows complete emitted-light loss from LOD 4 onward. It also establishes that the existing same-LOD path is not merely underpowered: the coarser payloads contain no records to tune.

For final transition validation, each important LOD 1 light cluster is matched to the same world-space area in the coarse capture. An important cluster has at least 64 connected LOD 1 pixels above the 2% enabled-minus-disabled threshold. Its mean positive luminance delta SHALL remain between 70% and 125% of the LOD 1 value, and its illuminated footprint SHALL remain between 65% and 135% of the LOD 1 value. The lower bounds reject progressive loss; the upper bounds reject coarse overbrightening and oversized pools. Whole-frame delta and footprint remain secondary diagnostics because geometry coverage changes between LODs.

The initial bounded representation constants are:

- Power uses an unsigned Q8.8 fixed-point field. Encoded source-equivalent power is clamped to `255.99609375`; ordinary emitters encode or imply exactly `1.0`.
- Metadata entries use four bytes: Q8.8 power, an unsigned integer world radius, and one reserved byte that MUST be zero. Absent metadata implies power `1` and radius `12`.
- Representative radius starts at `14` world blocks plus one quarter of the cluster's full 3D extent diagonal and is clamped to `28` world blocks; the wire-format safety maximum remains `64`. Ordinary LOD 1 records remain at radius `12`. Radius-aware indexing also caps occupied grid cells per representative at `512`.
- Client mesh-local gain starts from `sqrt(power)`, caps at `8`, applies the radius-dependent cap `max(1, 3 - (radius - 20) / 4)`, then applies radius-energy attenuation `min(1, (20 / radius)^e)`, where `e` is 6 at LOD 8, 1 at LOD 16 and 32, and 6 below LOD 8. LOD 4 additionally caps compressed gain at `0.75` to avoid a concentrated mid-detail brightness spike. Power remains monotonic for a fixed radius while broad representatives trade peak intensity for footprint at each sampling density. At LOD 16 and 32, the worker expands indexed/falloff radius by half the coarse-cell diagonal, capped by the 64-block wire safety limit, to cover representative center quantization; gain still uses the encoded source radius. The existing contribution clamp remains authoritative, and LOD 1 power `1`/radius `12` has gain `1`.
- When a vertex has more than 32 radius-aware candidates, the worker evaluates the nearest 32 by squared distance, then payload index. This is deterministic and prevents distant overlapping representatives from starving nearby light cues.
- Summary representative limits are `256` at every supported LOD. The target-LOD world grid has at most 256 horizontal cells per aligned node, so bounded retention first preserves one topmost cluster per occupied horizontal cell and then fills spare capacity by deterministic power priority. Payload conversion may retain fewer records but MUST use the same ordering.

These values intentionally reserve enough spatial representatives for the dense baseline while bounding a maximum-radius representative's grid fan-out. Final scene validation may tighten the caps, but changing them requires a summary and voxel cache signature change.

## Cold Summary Request Behavior

An uncached adjacent LOD 2 request in the fixed `SEASON3` area completed in `5.168 s`; the identical warm request completed in `3.75 ms`. Deferred construction would make the first payload knowingly omit light and would require a separate client refresh contract. The selected behavior therefore blocks for a valid summary for at most `30 s`. A timeout rejects the request without caching an incomplete coarse payload, while the shared in-flight summary promise continues building for a normal client retry. Persisted children and generation-local promise reuse bound subsequent work.
