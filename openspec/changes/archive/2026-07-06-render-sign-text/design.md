## Context

Sign text in Cubyz lives inside the `.region` chunk blobs, in the block-entity stream that immediately follows the block-array stream. Our parser (`src/server/parsers/region.ts`) already navigates to exactly the offset where this stream begins but explicitly seeks past it (`reader.seek(startPos + length)` with a "skip any block entity data" comment). The block array we already parse gives us each block's `typ` (palette index, identifies signs) and `data` (0-19 orientation). The missing half — the text — is therefore recoverable without any new file access.

On-disk facts (verified against the Cubyz game source):
- Region file: `[u32 version][u32 fileSize][u32 x 64 chunkLengths][chunk blobs...]`, big-endian, 4x4x4 = 64 chunks, chunk index `(x*4 + y)*4 + z`.
- Chunk blob: block-array stream, then block-entity stream, concatenated.
- Block-array algorithms that carry entities: `uniform` (2), `deflate` (4), `deflate_with_8bit_palette` (5). The `*_no_block_entities` variants (0, 1, 3) are legacy read-only and have no trailing entity stream.
- Block-entity stream: optional leading `u8` algo (`0` = raw), present only when non-empty; then records until blob end. Each record: `u16` big-endian position index (`u15` packed `x<<10 | y<<5 | z` within a 32^3 chunk), LEB128 varint length, then that many raw UTF-8 bytes. Empty-text signs produce no record.
- Sign text is raw UTF-8, no internal length prefix, no terminator; length is the varint. Game caps text at 100 visible chars / 500 bytes.

The game renders sign text via render-to-texture: it draws the text into a 128x72 RGBA texture (4px margin, Unscii-16, black, no shadow, per-line centered, `\n` + word-wrap at 120px, 16px line height) and maps it onto the sign model's front internal quad. This is exactly a "single flat quad glued to the board" — multiline is handled inside the texture, not the geometry.

The viewer's voxel contract is deliberately geometry-only (fixed-point verts, per-quad palette index, per-quad render-kind). The client currently receives only anonymous geometry and cannot re-derive per-block identity, orientation, or the sign face plane. `getSignQuads()` in `src/server/services/voxel-generator.ts` already computes the sign board geometry per orientation server-side. Existing client text/label infrastructure (canvas `THREE.CanvasTexture` in `primitives.ts`, Unscii font for DOM labels) can be reused.

## Goals / Non-Goals

**Goals:**
- Recover sign text from `.region` files by parsing the currently-skipped block-entity stream.
- Deliver per-sign records (world position, orientation `data`, text, text-plane corners) to the client through a route that goes through `VoxelMeshService`.
- Render sign text on the sign face as a single oriented textured quad, faithful to the game's layout (128x72 canvas, 4px margin, Unscii-16, black, centered, `\n` + word-wrap, 16px lines), including multiline.
- Show sign text only when closely zoomed in (LOD 1), with correct terrain occlusion and clean resource disposal.

**Non-Goals:**
- Editing sign text or any write path back to the world.
- Embedding sign text into the binary voxel mesh payload (payload stays geometry-only).
- Configurable text color/font (game currently hardcodes black Unscii-16; match it).
- Distance-based fade or per-sign culling beyond the LOD-1 gate.
- Pixel-perfect glyph-shaping parity with FreeType/HarfBuzz (monospace Unscii makes canvas measurement close enough).
- Rendering non-sign block entities.

## Decisions

### Decision 1: Parse the entity stream in the parser; join in the service

The parser (`region.ts`) decodes the block-entity stream into raw per-chunk records `{ positionIndex, payload }`. The join to signs (palette lookup → is-sign classification, `data` extraction, world position, text-plane corners) happens in `VoxelMeshService` / `voxel-generator.ts`, which is the one place that already holds both the block array and the sign shape logic.

Rationale: keeps `region.ts` a pure format decoder (no palette/shape knowledge), and keeps sign-specific semantics in the service layer that already owns them, consistent with the parsers/services separation the project enforces. Alternative — classifying signs inside the parser — would leak palette/shape concerns into the decoder and duplicate logic.

### Decision 2: Separate JSON route, not an extended mesh payload (Option A)

Sign records are served via a dedicated route through `VoxelMeshService`, returning JSON per region/LOD. The voxel mesh binary payload is untouched.

Rationale: text is sparse, structured, human-debuggable metadata — not geometry. Keeping the geometry contract pure avoids complicating the mesh binary parser and the worker protocol. Signs are rare, so the extra request is cheap. Alternative — appending a sign section to the binary payload — pollutes the clean contract and forces mesh-parser/worker changes for a rare case.

### Decision 3: Server sends text-plane corners, client does not re-derive orientation

Each sign record carries the four world-space corners of the text plane, computed by the same sign geometry code that positions the board (derived from `getSignQuads()` / the sign's front quad). The client maps its text canvas straight onto those corners.

Rationale: orientation math for 20 `data` states already exists server-side; duplicating it on the client risks the text drifting off the board and doubles maintenance. Sending corners makes the client a dumb, robust consumer. Alternative — sending `{x,y,z,data}` and re-deriving the transform client-side — duplicates non-trivial logic and invites divergence.

### Decision 4: Canvas texture on a quad (Option 2A), mirroring the game

The client paints text into a 128x72 canvas (4px margin → 120x64 usable, transparent, black Unscii-16, no shadow), wraps it in a `THREE.CanvasTexture` with nearest-neighbor filtering, and maps it onto a quad built from the record's corners, nudged slightly toward the sign's outward normal to avoid z-fighting. Line breaking replicates the game: split on `\n`, word-wrap at usable width via `measureText`, hard-break over-long words, center each line, stack at 16px, clip past 64px.

Rationale: this is the game's own method; "single quad" and "multiline" coexist because lines live in the texture. Nearest filtering preserves the pixel-font look. Alternatives: billboard sprite (rejected — faces camera, won't tilt with the sign), per-glyph voxel quads (rejected — heavy geometry for a zoom-in-only feature), CSS2D DOM labels (rejected — always camera-facing, no terrain occlusion).

### Decision 5: LOD-1 hard gate, imperative lifecycle in the scene runtime

Sign text quads are built only when the active LOD is 1 and removed when it changes away. All building/disposal is imperative inside the `World3DView` scene runtime (like markers/labels), never in React state. Region-scoped so quads dispose with their region and rebuild on sign-record changes; React Query invalidation is wired to `world-updated` / `terrain-updates-batch`.

Rationale: matches the "readable up close" intent with the simplest rule, avoids per-frame React churn (project constraint), and reuses the existing region lifecycle and disposal patterns.

## Risks / Trade-offs

- **Legacy `*_no_block_entities` chunks have no entity stream** → The parser keys entity-stream parsing off the block-array algorithm; for legacy algos it emits zero sign entries (no false reads). Bounds-check remaining bytes before reading.
- **Truncated/garbage entity stream causes over-read** → Parse defensively: stop at blob end, guard each `u16`/varint/payload read, emit records parsed so far, never throw (spec-mandated).
- **Canvas wrap points differ from FreeType/HarfBuzz by a character** → Acceptable: Unscii is monospace so advances are ~uniform; visual result reads identically. Documented as a non-goal.
- **Blurry text or z-fighting on the sign face** → Use nearest-neighbor filtering on the texture and offset the quad along the sign normal by a small epsilon in world units.
- **Many signs at LOD 1 create many textures** → Signs are sparse; scope textures per region and dispose on unload/LOD change. If needed later, a small glyph/atlas cache can be added (out of scope now).
- **Coordinate/axis mistakes (X/Y horizontal, Z vertical)** → Reuse the existing sign geometry code for corners so text inherits the same, already-correct convention rather than re-deriving positions.
- **Contract docs drift** → Update `docs/architecture-overview.md`, `docs/server-specification.md`, and `docs/client-specification.md` in the same change; run `npm run build` since a route payload/TS boundary changes.

## Migration Plan

Additive and behind a LOD gate; no data migration.
1. Land parser entity-stream decoding (verifiable by logging recovered text server-side, no client change).
2. Add service join + JSON route through `VoxelMeshService`; verify JSON for a known sign region.
3. Add client fetch hook + LOD-1 rendering + disposal.
4. Update docs; run `npm run check && npm run check:knip && npm run typecheck && npm run build`.

Rollback: remove the route registration and client rendering; the parser change is inert if unused (records simply unconsumed). The two halves (server plumbing vs. client rendering) can ship independently.

## Open Questions

- Exact URL shape and cache key for the sign route (align with the existing `/api/voxels` region addressing).
- Whether to invalidate sign records on `terrain-updates-batch` granularly per region or refetch affected regions wholesale (start wholesale per affected region).
- The precise world-space epsilon offset for the text plane to reliably avoid z-fighting across sign orientations (tune during implementation).
