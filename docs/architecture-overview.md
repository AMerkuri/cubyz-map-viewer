# Cubyz Map Viewer Architecture Overview

## Purpose

This document describes the system-level architecture and the shared contracts between the browser client and the Node.js server.

Keep cross-cutting behavior here. Client-only rendering details belong in `docs/client-specification.md`. Server-only API, watcher, cache, worker, and runtime configuration details belong in `docs/server-specification.md`. Deployment and container operations belong in `docs/deployment.md`.

## System Overview

Cubyz Map Viewer is an interactive voxel viewer for Cubyz worlds, with an optional terrain underlay derived from surface data.

The system has three main runtime pieces:

- a React and Three.js browser client
- a Node.js server that reads Cubyz save data and exposes HTTP and WebSocket endpoints
- a Cubyz save directory and Cubyz assets that provide world, biome, block, and entity data

At a high level:

1. The client fetches authoritative world data over HTTP.
2. The server reads and transforms Cubyz save files into terrain, biome, player, and voxel payloads.
3. The client renders a voxel scene from those payloads and can show terrain as an optional underlay.
4. The server watches the save directory and broadcasts change notifications over WebSocket.
5. The client reacts to those notifications by invalidating and reloading affected data.

## Shared Contracts

### Coordinate System

- world coordinates use `X` and `Y` horizontally and `Z` vertically
- voxel payloads preserve direct world coordinates, so the client does not mirror an axis
- treat this coordinate convention as stable unless both sides and the docs are updated together

### Camera URL Contract

- camera URLs use world-coordinate `x`, `y`, `z` plus `zoom`, `theta`, and `phi` query parameters
- viewer-generated copied-location URLs include `focus=exact`, which tells the client to restore the supplied camera target exactly
- URLs without `focus=exact` are accepted as map-compatible links; the client may retarget their supplied altitude to the best available visible surface at the supplied `x,y` while preserving `zoom`, `theta`, and `phi`

### Source Data Layout

- surface tiles come from `maps/{lod}/{worldX}/{worldY}.surface`
- region voxel data comes from `chunks/{lod}/{worldX}/{worldY}/{worldZ}.region`
- supported LODs are `1, 2, 4, 8, 16, 32`
- surface tile size is `MAP_SIZE = 256`

### Transport Roles

- HTTP provides authoritative world payloads
- WebSocket provides low-latency invalidation and change notifications only
- the client refetches HTTP resources after relevant WebSocket events instead of treating socket payloads as the source of truth

### Terrain Contract

- terrain payloads are seam-safe across same-LOD tile borders
- each terrain response includes the visible vertex grid plus a 1-vertex gutter derived from the same-LOD tile neighborhood
- the client uses that gutter data when rebuilding terrain so same-LOD tile borders stay visually consistent
- when terrain tile topology changes, the client refreshes affected visible terrain instead of assuming the old mesh still matches neighboring data

### Voxel Contract

- voxel payloads are requested by LOD and region coordinates
- the server retains identity and compressed voxel payloads in one LRU constrained by both entry count and distinct backing-buffer bytes; compression variants reweigh entries and oversized meshes are served without retention. Resolved emitter-summary nodes use a separate weighted LRU constrained by entries and serialized UTF-8 estimated bytes; its metrics label this as an estimate rather than exact V8 heap residency, individually oversized nodes are not retained in memory, and invalidated in-flight work cannot repopulate cache state. Conditional ETag preparation relies on this bounded summary-service state rather than an unbounded request handoff map. `VOXEL_WORKERS` defaults to `1` and resolves once as both worker-isolate capacity and the FIFO concurrency limit for cold main-isolate LOD `1` summary leaves; larger explicit values improve fresh-cache throughput at the cost of more overlapping memory-heavy work
- voxel workers bound resolved represented-emitter data by true-LRU entry and source-count limits while keeping active promise deduplication separate
- distinct worker admission is FIFO and bounded by `VOXEL_QUEUE_LIMIT` (default `8`) after compatible same-key/version consumers join existing work; running jobs do not count as queued capacity. Express disconnects remove individual consumers, final-consumer queued work is removed, and orphaned running output skips validation/compression/cache work unless demand rejoins before worker completion. Complete-pipeline ownership and epoch checks prevent duplicate post-worker generation pipelines and stale compressed variants
- each worker reports phase-labelled generation memory with its result, transfers any payload ownership, and then reports an idle memory/cache snapshot. The pool does not settle the job, recycle the slot, or dispatch queued work until that idle boundary. Routine retirement is serialized and defaults to 512 MiB idle external/ArrayBuffer high-water or 32 completed jobs; explicit zero disables each threshold
- `/api/world/chunk-index` returns one entry per available voxel region column with `lod`, `regionX`, and `regionY`
- `/api/world/block-palette` returns the save block palette string table so the client can resolve voxel face palette indices to saved block IDs without per-hover requests
- the server generates payloads from `.region` files and keeps coordinate space in world units
- cold LOD `1` emitter-summary leaves and neighboring halo-source lookups use one lightweight represented-emitter extractor. It shares block representation, emitted-color, traversability, represented-LOD, surface-depth, and open-face semantics with normal generation while avoiding face maps, merged/model geometry, boundary samples, encoded payloads, and persistent voxel meshes. Summary leaves retain their bounded main-isolate limiter; halo lookups retain worker-local in-flight sharing and bounded resolved-source reuse
- the server resolves palette-indexed block visual metadata from layered Cubyz block definitions, including inherited `_defaults.zig.zon` values, and distinguishes air, opaque renderable, and transparent renderable blocks before voxel meshing
- the server resolves Cubyz block shape metadata from layered block definitions, OBJ model assets, and supported rotation semantics, preserves supported OBJ vertices as authored block-local coordinates even when model bounds exceed `0..1`, keeps full-cube terrain on the greedy meshing path, and emits explicit quads for supported LOD `1` non-cube block models or generated semantic shapes; this includes `cubyz:texture_pile` blocks (such as leaf piles) rendered as their referenced plane model instead of full cubes, and `cubyz:sign` floor/ceiling variants rendered with eight-way 45-degree orientation
- changing how a supported Cubyz shape, OBJ coordinate interpretation, or rotation semantic is interpreted invalidates persisted voxel meshes through the shape-metadata signature and the voxel generator cache version, so stale geometry is regenerated rather than reused
- voxel mesh payloads use a cache-versioned mixed record layout: ordinary greedy cube quads are encoded as parametric rectangles (`face`, `plane`, `u`, `v`, `du`, `dv`) relative to the response origin, while model/semantic quads use four authored fixed-point vertices in `1/4096` voxel-cell units; the client decodes both forms to the same world coordinate space
- voxel mesh payloads include one packed AO byte per quad; at LOD `1` and `2` that AO applies to top faces and to a thin top band on vertical walls so tall cliffs do not get full-height AO gradients, while the client still performs the final visibility-dependent top-edge seam softening after LOD coverage is resolved
- voxel mesh payloads include a compact per-quad block palette index section; the client preserves this as per-triangle metadata through worker quadrant splitting so voxel raycast hover can display the saved block ID for the visible face
- voxel mesh payloads include compact per-quad render-kind data plus header-level greedy/model record counts so the client can build opaque and transparent meshes separately while preserving colors, normals, AO, winding, positions, and palette identity, and so diagnostics can distinguish greedy cube quads from model/semantic quads without per-quad source/position-kind side arrays
- voxel mesh payloads include a versioned compact emitter-record section after greedy/model geometry records; an LOD `1` own emitter is created only after the source contributes an accepted cube face or model/semantic quad, so hidden, depth-suppressed, or model-budget-rejected `.emittedLight` metadata cannot create a record. Records retain signed response-relative coordinates, RGB bytes, and open-face masks without changing the binary layout
- the server builds LOD `1` halo records from lightweight neighboring represented-source extraction. External candidates must have an open face, fall within the visible vertical envelope, and reach generated opaque receiving geometry within radius before the existing deterministic 8,192-record selection boundary ranks them; edge and corner reservations therefore preserve relevant seam sources without constructing full neighboring meshes
- coarser payload emitters come from a persisted hierarchy of bounded, represented LOD `1` source summaries aligned to LOD `1, 2, 4, 8, 16, 32` region footprints. Coarse generation retains qualified source energy, including small source models replaced by air, only when the representative radius reaches generated opaque geometry at the requested LOD; neighbor-owned records remain payload-local halos for equivalent boundary baking without duplicate runtime accents
- the VXM6 header optionally identifies one four-byte metadata entry per emitter (`u16` Q8.8 source-equivalent power, `u8` world radius, zero reserved byte); absent metadata means power `1` and radius `12`, which keeps ordinary LOD `1` records compact and behaviorally unchanged; metadata count/offset/bounds are validated independently
- the browser worker first decodes complete base geometry without constructing an emitter grid. When emissive enhancement is applicable, it returns ownership of the original compact payload and later deterministically traverses it to emit only per-quadrant normalized emissive arrays. Halo records participate only in that payload-local enhancement, while loaded LOD 1 tiles retain own-emitter metadata for runtime accents. Coarse aggregate centroids participate in mesh-local illumination but never create glow sprites or point lights because they are not physical source blocks. On rendered frames that pass the active/idle cap, a loaded-voxel revision gates region reconciliation and the main thread uses bounded deterministic nearest selection to assign a fixed global glow pool and bounded point-light pool. The shared shader uniform drives the baked day-floor-to-night emissive result independently; glow sprites and dynamic Lambert point lights are optional accents and are hidden transition-safely when inactive
- the browser mesh-worker contract has progressive `base` and `enhancement` requests/results plus the debug-comparison `mesh` one-phase request/result and shared `cancelled`/`error` outcomes. Every variant carries a stable job ID, phase, and refresh version; enhancement variants also carry the target base-mesh identity. Decode, output writing, and emissive enhancement cooperatively yield and check cancellation; an observed pre-transfer cancellation returns only `cancelled`, while the main thread retains phase/version/base validation for a result whose transfer committed before cancellation was observed
- seam-affecting server changes cross this payload/cache/worker boundary and therefore require the hermetic `node:test` matrix (`npm test`, or focused voxel and core service/API, watcher, client, and terrain commands) for X/Y edges, corners, vertical extremes, dense own and both-side pressure, missing/special neighbors, coarse summary halos, live invalidation, and terrain gutters. Tests use isolated generated `.surface`/`.region` saves or fakes, decode retained records deterministically, and invoke the production worker and terrain builder to compare normalized emissive attributes or terrain normals at matching world positions. Opt-in benchmarks are not correctness gates. `bench:voxel:real-save` starts isolated one-worker and eight-worker servers against an explicit real save, uses separate temporary persistent-cache roots, repeats one checked request manifest for cold and warm phases, drains compressed payloads, and records process RSS plus mesh/worker/summary metrics as JSON and a table for reproducible retention comparisons.
- LOD `1` model/semantic geometry has a high per-region safety ceiling that only bounds pathological payloads; ordinary dense decorative regions (spawn areas, sign-heavy plots, forests) render their full model geometry, and the dropped model-quad count is reported in service metrics only when the ceiling is exceeded
- debug-only voxel-lighting diagnostics: the client may request `/api/voxels/...?halo=0` to receive a payload generated without neighboring-region halo emitter records; such diagnostic payloads are cached and ETagged separately from normal payloads, and voxel responses expose cache/timing, own/halo/coarse representative counts, metadata bytes, encoded power/radius ranges, and summary cache/build/leaf/source/retention metrics; the client additionally reports emissive grid-build, bake, and evaluated/culled quad metrics; default behavior (no query parameter) is unchanged
- the client uses loaded voxel mesh bounds to keep nearby visible geometry detailed, while unloaded regions still rely on cheap region-aligned distance heuristics from the chunk index
- the client may apply final visibility-dependent shading after LOD coverage is resolved, so the payload structure and face-data semantics must stay aligned across both sides
- live voxel invalidation uses the shared pure mechanics in `src/server/services/voxel-invalidation.ts`: a changed LOD `1` region affects its 12-world-unit emitter halo and aligned ancestors at every supported coarse LOD, while a changed coarse region affects same-LOD neighbors reached by the 28-world-unit summary radius. Batch expansion floor-aligns negative coordinates and unions source and affected keys before either side mutates cache or refresh state; the WebSocket event name and payload remain unchanged

### Client Voxel Pipeline

The voxel HTTP route and binary payload are unchanged by client scheduling. `World3DView` owns a ref-backed `VoxelWorkScheduler` and moves each accepted tile/version through an explicit pipeline instead of allowing completed responses to accumulate in the browser worker's message queue:

```text
selected request
  -> fetching
  -> compact input
  -> active base worker
  -> expanded base output
  -> atomic scene insertion / first visible
  -> retained enhancement input (optional)
  -> active enhancement worker
  -> in-place normalized attribute attachment
```

Cancellation, discard, and error are terminal exits from the applicable stage. A work record is identified by a monotonically increasing client `jobId`, tile key, and refresh `version`; it also retains the latest coverage/view priority, compact and expanded byte counts, and stage timestamps. Terminal processing removes the record and releases its accounting exactly once, so a duplicate worker response or terminal event cannot free the same capacity twice.

Backpressure is applied at every asynchronous ownership boundary:

- fetch admission is limited first by `maxConcurrentVoxelFetches` and also stops whenever the compact-input stage has no job or byte capacity
- response sizes are unknown when HTTP work starts, so requests already in flight may complete after the compact-input limit is reached; one item larger than the complete byte limit can occupy an otherwise empty stage, after which further fetch admission remains blocked until it drains
- completed `ArrayBuffer` responses stay on the main thread in the prioritized compact-input stage; they are not posted eagerly to the worker
- every idle pool worker requests the best current eligible compact input. A worker ID owns at most one active phase, and queued urgent base work is exhausted before enhancement can claim an idle slot
- dispatch reserves a prospective expanded-output estimate derived from compact quad metadata and bounded phase/LOD output history. Queued output plus all active reservations must fit the output job/byte limits; retained enhancement compact bytes remain charged until dispatch or termination
- one reservation or actual expanded result may exceed the output byte limit when reservations and queued output are otherwise empty; no subsequent phase dispatches until enough capacity drains
- scene insertion is independently bounded by `maxVoxelMeshesPerFrame` and `voxelMeshBuildBudgetMs`; each slot takes the highest-priority current base result rather than FIFO output, and expanded-output bytes are released when an item is inserted, rejected as stale/obsolete, or fails during scene construction
- completion, cancellation acknowledgement, and worker error reconcile or release that worker's reservation exactly once and immediately retry every idle slot plus fetch admission. A failed worker is terminated and replaced up to the current target; scale-down lets valid busy work finish and retires excess workers only when idle

The browser pool uses conservative profiles rather than `hardwareConcurrency`: explicit desktop-class fine-pointer input starts at two workers with maximum four, coarse-pointer/mobile-class input starts at one with maximum two, an available device-memory hint below 4 GiB caps the pool at one, and missing hints fall back to one with maximum two. The pure adaptive reducer uses bounded queue-age, frame, worker, scene, byte, memory, and recent camera-motion samples. It can add only one worker after sustained healthy demand and cooldown, but reduces the target immediately under unhealthy pressure. `voxelWorkerTarget = 0` selects adaptive behavior; `1` through `4` selects a fixed target still capped by the safety profile.

Priority is recomputed as camera generations change while work remains queued and is applied at fetch admission, compact dispatch, and scene-ready selection. Safety bands keep conservatively visible no-fallback holes first; continuously demanded focus base work is promoted ahead of rear/non-visible coverage as its 2.5-second deadline enters the 500-millisecond slack window, while capped aging cannot pass a visible hole. `demandSince` survives selection-generation reprioritization but resets when demand disappears or the tile refresh identity changes. Within the same urgency band, focus then forward then peripheral then rear wins, base precedes enhancement, and capped age, projected benefit, distance, LOD, and stable sequence deterministically break remaining ties. Active work is cooperative and is not preempted for a priority change.

### Cancellable Browser Worker Protocol

Main-thread and browser-worker messages use the shared `WorkerIn` and `WorkerOut` discriminated unions:

- `base` carries `jobId`, phase, refresh `version`, transferred compact `buffer`, LOD/region coordinates, enhancement selection, and optional benchmark metadata; `base-result` transfers complete base arrays and either the same compact buffer ownership or `null`
- `enhancement` carries a separately scheduled job/phase identity, refresh version, base-mesh identity, and the transferred retained compact buffer; `enhancement-result` transfers only ordered non-empty quadrant emissive arrays
- `mesh`/`mesh-result` retain one-phase base-plus-emissive behavior for the debug fallback and benchmark baseline
- `cancel` carries the exact job, phase, refresh version, and enhancement base identity when applicable
- `cancelled` carries the identity/version, coordinates, and timing but no expanded arrays
- `error` carries the identity/version, coordinates, timing, an error string, and optional benchmark data

Each pool worker runs one phase job at a time. For its active job it records cancellation by the combined job/phase/version identity. Optimized decode checks cancellation before allocation, during record decoding and quad writing, during emissive work, and at a forced-yield boundary immediately before transfer. Long loops yield to the worker event loop on the worker's bounded time budget so a `cancel` message can be observed. Cancellation seen before commit abandons partial arrays and emits only `cancelled`.

Cancellation remains cooperative, not transactional. A committed result can arrive after demand removal or refresh supersession. Base acceptance requires an active matching phase/version and current fetch demand (or a loaded stale replacement). Progressive enhancement has a separate target-validity lease: it remains eligible after its newly inserted base becomes fresh and leaves fetch demand, provided the current loaded tile is fresh for the same refresh version and has the scheduled/result base-mesh identity. Unload, warm-cache movement, replacement, or staleness invalidates that lease and rejects or cancels the enhancement without touching unrelated geometry. A result that loses this race is counted as a discard such as `cancel-race`, `result-validation`, or `enhancement-target-mismatch`, and terminal accounting releases retained compact, reservation, active, and output ownership once.

### Sign Text Contract

- sign text is served separately from the binary voxel mesh; the mesh payload stays geometry-only
- `/api/signs/{lod}/{regionX}/{regionY}` returns a JSON array of per-region sign records, keyed by LOD and region coordinates consistent with the voxel/region addressing scheme, and routed through `VoxelMeshService`
- each sign record has `position` (world block minimum corner, `X`/`Y` horizontal and `Z` vertical), `data` (orientation `0-19`), `text` (raw UTF-8 Cubyz formatted source text with formatting controls such as color codes, emphasis toggles, escapes, resets, and `\n` preserved verbatim, exactly as decoded from the block entity), and `corners` (four world-space corners of the sign's text plane)
- the server recovers sign text by decoding the block-entity stream that trails entity-carrying `.region` chunk blobs and joins it with the block palette and sign shape classification; empty-text signs and non-sign block entities produce no record; the server does not strip, normalize, or pre-render Cubyz text formatting controls
- the server sends the text-plane corners so the client does not re-derive orientation; the corners are computed from the same sign geometry that positions the board
- signs with no records return an empty JSON array; regions with no signs and coarser LODs (`> 1`) return an empty array
- the client renders sign text only at LOD `1`, decoding the formatted source text with Cubyz `TextBuffer.Parser` semantics before layout so color codes, bold, italic, underline, strikethrough, escapes, and reset do not render as visible glyphs; each sign is rendered as a single texture-mapped quad placed on the four corners, occluded by terrain, and invalidated on `world-updated` and `terrain-updates-batch` events for affected regions

### Live Update Contract

- save watching batches filesystem churn into grouped update events
- the main event names are `players-updated`, `world-updated`, `surface-index-changed`, and `terrain-updates-batch`
- `players-updated` is a server-side invalidation hint only: the server waits for a short quiet window, reloads `/api/players`, compares a semantic player snapshot, and only broadcasts when the player view state actually changed
- `/api/players` includes `isActive` as the server-owned player activity flag for client styling, while stale player removal uses a longer retention window
- `/api/players` also includes `entityModelId`, the resolved player avatar model ID for each player; it is part of the semantic snapshot, so avatar-only save changes trigger `players-updated`
- if event names, payload shapes, or update semantics change, update the server, client, and docs together
- an LOD `1` region update invalidates its exposure-dependent neighboring leaves, aligned summary ancestors through LOD `32`, dependent coarse voxel cache identities, and loaded or warm client tiles for those ancestor footprints before they refresh through the normal voxel route

### Player Avatar Contract

- each player's avatar is decoded server-side from the saved `cubyz:model` entity component in `players/*.zon` (`entity.components`, URL-safe base64) and resolved through `entity_component_palette.zig.zon` and `entity_model_palette.zig.zon`
- resolution is conservative: missing, malformed, or out-of-range component data, missing palettes, or out-of-range palette indices fall back to the default avatar `cubyz:snale`; any other palette-resolved model ID is returned verbatim so the manifest service and client can decide whether it renders
- the viewer renders any avatar whose `entityModels` descriptor is tagged `.playerModel` (or backstopped by the vanilla `SUPPORTED_PLAYER_MODEL_IDS` set: `cubyz:snale`, `cubyz:snail`, `cubyz:moffalo`, `cubyz:cubert`) and has resolvable model/texture assets; custom namespaces such as `skinz:` are eligible via the tag

### Player Marker Asset Contract

- player marker models are discovered server-side from layered Cubyz `entityModels/**/*.zig.zon` descriptors
- layered asset precedence is core Cubyz assets first and save assets second, so matching save asset files override core files for descriptors, GLB models, and PNG textures
- `/api/assets/player-marker/:entityModelId` returns the manifest for a specific requested avatar model ID (any palette-resolved string) with `available`, `entityModelId`, `modelUrl`, `textureUrl`, `height`, and `coordinateSystem`; `/api/assets/player-marker` remains as the default `cubyz:snale` manifest
- a resolvable descriptor must be tagged `.playerModel` or be backstopped by the vanilla `SUPPORTED_PLAYER_MODEL_IDS` set, and must have resolvable `model` and `defaultTexture` references
- when a requested avatar has no loadable descriptor, the manifest returns `available: false` and the client keeps rendering the default avatar or fallback dot markers
- model and texture URLs from the manifest are opaque server-generated asset URLs; the browser must not construct filesystem paths directly

## Documentation Map

- `docs/architecture-overview.md`: system overview and shared client/server contracts
- `docs/client-specification.md`: client architecture, rendering flow, state ownership, and live-update handling
- `docs/server-specification.md`: server architecture, route flows, watcher flow, caching, workers, and runtime configuration
- `docs/deployment.md`: image publishing, container runtime setup, mounts, and deployment troubleshooting
