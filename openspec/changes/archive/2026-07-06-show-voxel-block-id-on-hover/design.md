## Context

Voxel cursor hover is handled in the client by raycasting against rendered voxel meshes and reporting `CursorHoverInfo` to the app-level HUD. The current payload includes coordinates and optional debug voxel LOD/region information, but no block identity.

The server already knows the block palette index for each generated voxel quad while building the voxel mesh. `BinaryQuad.typ` carries that palette index, but the current binary voxel mesh contract converts it to RGB color and does not send the type to the client. The client therefore cannot recover an authoritative block ID from a rendered face.

Terrain underlay is not a block-inspection surface. It remains coordinate-only and is not extended with block lookup behavior.

## Goals / Non-Goals

**Goals:**

- Display the saved block ID for hovered rendered voxel faces, for example `cubyz:grass` or `cubyz:log/oak`.
- Keep hover behavior tied to the actual voxel mesh face hit by the raycaster.
- Avoid per-hover server requests.
- Preserve existing terrain hover behavior.
- Keep the displayed identity to block ID only.

**Non-Goals:**

- Showing block data, orientation, variant, or model metadata.
- Adding block identity to terrain-underlay hover.
- Adding a generic coordinate-to-block inspection API for arbitrary world positions.
- Changing WebSocket event semantics.

## Decisions

### Carry palette index per rendered voxel face

The voxel mesh binary format will include the block palette index for each rendered quad. The client worker will decode this sidecar data alongside positions, colors, AO, and winding flags, and preserve enough metadata on each quadrant mesh to resolve the block type for a raycast hit.

Alternatives considered:

- **Infer block type from color**: rejected because colors are not unique and may be fallback/tinted values.
- **Fetch block-at-coordinate on every hover**: rejected because it adds latency, request spam, caching complexity, and coordinate-boundary ambiguity.
- **Embed block ID strings per quad**: rejected because strings would be repeated across every voxel region payload and inflate a hot rendering response.

### Resolve palette indices to block IDs from a palette string table

The client needs a stable mapping from block palette index to saved block ID. The implementation should expose or transfer the block palette entries once per world/session, then store palette indices on voxel mesh metadata and resolve them in the cursor path.

If an index is missing or out of range, the hover should omit the block ID rather than displaying misleading fallback text.

Alternatives considered:

- **Send strings directly inside each voxel mesh response**: simpler lookup but repeats data for every region.
- **Add only response headers**: insufficient for the full palette table and not ergonomic for worker decoding.

### Use voxel raycast metadata, not sampled terrain state

The block ID will only be reported when the selected hover intersection is a voxel mesh intersection. Terrain intersections continue to report coordinates only. This matches the user-visible surface and avoids implying that terrain underlay is exposing block-level data.

### Resolve the hit face from Three.js intersection data

For indexed voxel geometry, `intersection.faceIndex` identifies the triangle hit. Since each quad is emitted as two triangles, the implementation can map the triangle back to its quad or attach expanded per-triangle/per-face metadata during worker decode. The selected strategy should remain local to voxel mesh metadata and avoid React state updates on every hover.

## Risks / Trade-offs

- **Voxel payload size increases** -> Store compact numeric palette indices, prefer `u16` when safe for the palette range, and keep strings out of per-region payloads.
- **Binary contract changes can desynchronize client/server** -> Update the voxel decoder and encoder together, include defensive parsing/versioning or size checks, and document the payload layout.
- **Raycast face-to-quad mapping can be wrong after quadrant remapping** -> Preserve face type metadata through the worker's quadrant split so local geometry indices and metadata stay aligned.
- **LOD meshes may represent merged faces** -> Display the palette index for the rendered face; the existing LOD/debug text continues to communicate the hovered voxel LOD.
- **Missing palette mapping** -> Omit `blockId` from `CursorHoverInfo` and keep coordinate display working.

## Migration Plan

No persisted data migration is required. The server and client must be deployed together because the voxel mesh binary payload changes. During development, update documentation and run the full verification set including `npm run build` because this touches route payloads and worker boundaries.

Rollback is to restore the previous voxel mesh payload/decoder and coordinate-only cursor HUD.

## Open Questions

None.
