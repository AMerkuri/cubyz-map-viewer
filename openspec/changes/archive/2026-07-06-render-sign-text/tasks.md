## 1. Parser: decode block-entity stream

- [x] 1.1 In `src/server/parsers/region.ts`, identify the block-array compression algos that carry a trailing entity stream (`uniform`, `deflate`, `deflate_with_8bit_palette`) vs. legacy `*_no_block_entities` algos that do not.
- [x] 1.2 Replace the "skip block entity data" seek for entity-carrying algos with reading the remaining chunk bytes as the block-entity stream.
- [x] 1.3 Decode the stream: optional leading `u8` algo byte (`0` = raw) only when non-empty, then records until blob end; each record is a `u16` big-endian position index (`u15` `x<<10 | y<<5 | z`), a LEB128 varint length, and that many raw bytes.
- [x] 1.4 Parse defensively: bounds-check each read, stop at blob end on truncation, return records parsed so far, never throw.
- [x] 1.5 Extend `ChunkData` (or add a sibling structure) to return raw per-chunk entity records `{ positionIndex, payload }` alongside `blocks`.
- [x] 1.6 Verify by logging recovered records for a known sign chunk (no client involvement yet).

## 2. Service: join entities into sign records

- [x] 2.1 In `VoxelMeshService` / `src/server/services/voxel-generator.ts`, for each entity record, look up the block at its position, classify sign blocks via palette + shape table, and skip non-signs.
- [x] 2.2 Validate the payload as UTF-8; skip records that fail validation. Preserve `\n` verbatim.
- [x] 2.3 Extract the block `data` (0-19) and compute the sign world position using X/Y-horizontal, Z-vertical convention.
- [x] 2.4 Derive the four world-space text-plane corners from the same sign geometry logic used by `getSignQuads()` so the plane is coplanar with the sign board.
- [x] 2.5 Assemble per-region sign records `{ position, data, text, corners }` during meshing; omit empty-text signs.
- [x] 2.6 Expose a `VoxelMeshService` method that returns sign records for a given LOD + region.

## 3. Server: sign records HTTP route

- [x] 3.1 Add a route under `src/server/api/` that returns per-region sign records as JSON, keyed by LOD + region coords, aligned with `/api/voxels` addressing; route through `VoxelMeshService` (do not bypass).
- [x] 3.2 Return an empty JSON array for regions with no signs; handle invalid LOD/coords consistently with existing voxel routes.
- [x] 3.3 Register the route in the server composition root (`src/server/index.ts`).
- [x] 3.4 Verify the JSON response for a known sign region.

## 4. Client: fetch sign records

- [x] 4.1 Add a fetch function + React Query hook in `src/client/features/world-view/` for per-region sign records, keyed by LOD + region coordinate.
- [x] 4.2 Gate fetching to LOD 1 (the sign-text threshold) for visible regions.
- [x] 4.3 Wire invalidation of sign records to `world-updated` and `terrain-updates-batch` WebSocket events for affected regions.

## 5. Client: render text on the sign face

- [x] 5.1 Implement a canvas text painter: 128x72 canvas, 4px margin (120x64 usable), transparent, black, Unscii-16 at native pixel size, no shadow.
- [x] 5.2 Implement line breaking matching the game: split on `\n`, word-wrap at usable width via `measureText`, hard-break over-long words, center each line, stack at 16px, clip past 64px.
- [x] 5.3 Wrap the canvas in a `THREE.CanvasTexture` with nearest-neighbor filtering; dispose on rebuild.
- [x] 5.4 Build a quad from the record's four corners, offset slightly along the sign normal to avoid z-fighting, with terrain occlusion enabled (depth-tested).
- [x] 5.5 Drive building/disposal imperatively in the `World3DView` scene runtime, scoped per region; no per-frame sign state in React.

## 6. Client: LOD gating and lifecycle

- [x] 6.1 Build sign text quads only at LOD 1; remove them when the active LOD changes away from 1 and rebuild when it returns.
- [x] 6.2 Dispose canvases, textures, geometries, and materials on region unload, sign-record change, or LOD change away from threshold.

## 7. Docs and verification

- [x] 7.1 Update `docs/architecture-overview.md` for the new sign route and per-sign record contract.
- [x] 7.2 Update `docs/server-specification.md` (parser entity-stream decoding, sign record shape, route) and `docs/client-specification.md` (fetch hook, on-face rendering, LOD gate).
- [x] 7.3 Run `npm run check && npm run check:knip && npm run typecheck`.
- [x] 7.4 Run `npm run build` (route payload + TS boundary changes).
- [x] 7.5 Manually verify: at LOD 1 a known sign shows its text (single- and multi-line) on the face, occluded by terrain, and disappears when zoomed out.
