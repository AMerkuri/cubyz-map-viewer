/**
 * Off-thread voxel mesh builder.
 *
 * Receives the raw binary ArrayBuffer produced by greedyMeshBinary() on the
 * server (transferred zero-copy from the main thread), decodes it, applies the
 * coordinate transform (Y-negation + winding swap) required by the Three.js
 * scene, and computes flat per-face normals.  The resulting typed arrays are
 * transferred back to the main thread so Three.js can build the BufferGeometry
 * without any heavy work on the render/event thread.
 *
 * Binary layout (all little-endian):
 *   Header 24 bytes:
 *     i32 worldX, i32 worldY, i32 worldZBase, u32 quadCount, u32 indexCount
 *     u32 voxelSize
 *   Per-quad color section (quadCount × 3 bytes, padded to 4-byte alignment):
 *     u8 r, u8 g, u8 b per quad
 *   Per-vertex position section (quadCount × 4 × 4 bytes):
 *     u8 relX, u8 relY, u16 relZ per vertex
 *   Index section (indexCount × 4 bytes):
 *     u32[] – 6 indices per quad, two CCW triangles
 */

interface WorkerIn {
  buffer: ArrayBuffer;
  lod: number;
  regionX: number;
  regionY: number;
  version?: number;
}

interface WorkerOut {
  lod?: number;
  regionX: number;
  regionY: number;
  version?: number;
  quadrantMeshes?: {
    quadrantIndex: number;
    positions: Float32Array;
    normals: Float32Array;
    colors: Float32Array;
    indices: Uint32Array;
  }[];
  /** 16-bit bitmask: bit (cx*4+cy) set ↔ chunk column (cx,cy) has ≥1 non-air block. */
  chunkCoverage?: number;
  /** Max visible voxel Z per 32×32 chunk column; -Infinity means no exposed faces. */
  chunkTopHeights?: Float32Array;
  voxelSize?: number;
  minZ?: number;
  maxZ?: number;
  error?: string;
}

self.onmessage = (e: MessageEvent<WorkerIn>) => {
  const { buffer, lod, regionX, regionY, version } = e.data;

  try {
    const result = buildMeshArrays(buffer);
    const transferables: Transferable[] = [result.chunkTopHeights.buffer];
    for (const quadrant of result.quadrantMeshes) {
      transferables.push(
        quadrant.positions.buffer,
        quadrant.normals.buffer,
        quadrant.colors.buffer,
        quadrant.indices.buffer,
      );
    }
    const out: WorkerOut = { lod, regionX, regionY, version, ...result };
    (self as unknown as DedicatedWorkerGlobalScope).postMessage(
      out,
      transferables,
    );
  } catch (err) {
    const out: WorkerOut = {
      regionX,
      regionY,
      lod,
      version,
      error: err instanceof Error ? err.message : String(err),
    };
    (self as unknown as DedicatedWorkerGlobalScope).postMessage(out);
  }
};

function buildMeshArrays(buf: ArrayBuffer): {
  quadrantMeshes: {
    quadrantIndex: number;
    positions: Float32Array;
    normals: Float32Array;
    colors: Float32Array;
    indices: Uint32Array;
  }[];
  chunkCoverage: number;
  chunkTopHeights: Float32Array;
  voxelSize: number;
  minZ: number;
  maxZ: number;
} {
  if (buf.byteLength < 24) throw new Error("buffer too small for header");

  const view = new DataView(buf);
  const worldX = view.getInt32(0, true);
  const worldY = view.getInt32(4, true);
  const worldZ = view.getInt32(8, true);
  const quadCount = view.getUint32(12, true);
  const indexCount = view.getUint32(16, true);
  const voxelSize = view.getUint32(20, true) || 1;

  const vertexCount = quadCount * 4;

  // Color section: 3 bytes per quad, padded to 4-byte boundary
  const colorPadded = (quadCount * 3 + 3) & ~3;
  const expectedSize = 24 + colorPadded + vertexCount * 4 + indexCount * 4;
  if (buf.byteLength < expectedSize) throw new Error("buffer truncated");

  // The server appends a u32 LE chunk-coverage bitmask after the mesh data.
  // If the trailer is absent (stale server cache from before this feature was
  // added), fall back to 0xFFFF: any mesh response implies blocks exist, so
  // terrain should be hidden underneath rather than shown through it.
  const chunkCoverage =
    buf.byteLength >= expectedSize + 4
      ? view.getUint32(expectedSize, true)
      : 0xffff;

  // --- Positions (with Y-negation for Three.js coordinate system) ---
  // sceneY = -worldY so that increasing world Y moves toward -Y in scene space.
  const positions = new Float32Array(vertexCount * 3);
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  let off = 24 + colorPadded;
  for (let vi = 0; vi < vertexCount; vi++) {
    const rx = view.getUint8(off++);
    const ry = view.getUint8(off++);
    const rz = view.getUint16(off, true);
    off += 2;
    positions[vi * 3] = worldX + rx * voxelSize;
    positions[vi * 3 + 1] = -(worldY + ry * voxelSize); // Y-negation
    positions[vi * 3 + 2] = worldZ + rz * voxelSize;
    if (positions[vi * 3 + 2] < minZ) minZ = positions[vi * 3 + 2];
    if (positions[vi * 3 + 2] > maxZ) maxZ = positions[vi * 3 + 2];
  }
  if (!Number.isFinite(minZ)) minZ = 0;
  if (!Number.isFinite(maxZ)) maxZ = 0;

  // --- Colors (per-quad → per-vertex, normalized 0–1) ---
  const colors = new Float32Array(vertexCount * 3);
  let colorOff = 24;
  for (let qi = 0; qi < quadCount; qi++) {
    const r = view.getUint8(colorOff++) / 255;
    const g = view.getUint8(colorOff++) / 255;
    const b = view.getUint8(colorOff++) / 255;
    const base = qi * 4;
    for (let v = 0; v < 4; v++) {
      colors[(base + v) * 3] = r;
      colors[(base + v) * 3 + 1] = g;
      colors[(base + v) * 3 + 2] = b;
    }
  }

  // --- Indices (with b↔c swap to fix winding after Y-negation) ---
  // Y-negation flips triangle winding; swapping the two non-pivot vertices
  // in every triangle restores the original outward-facing normals.
  const indices = new Uint32Array(indexCount);
  for (let i = 0; i < indexCount; i += 3) {
    const a = view.getUint32(off, true);
    off += 4;
    const b = view.getUint32(off, true);
    off += 4;
    const c = view.getUint32(off, true);
    off += 4;
    indices[i] = a;
    indices[i + 1] = c; // swap b↔c
    indices[i + 2] = b;
  }

  // --- Flat normals ---
  // Every quad is planar, so each pair of triangles shares one normal.
  // We compute the cross product once per triangle; because both triangles in
  // a quad are coplanar, the second write for each vertex is identical to the
  // first and is simply overwritten with no correctness issue.
  const normals = new Float32Array(vertexCount * 3);
  for (let i = 0; i < indexCount; i += 3) {
    const ia = indices[i];
    const ib = indices[i + 1];
    const ic = indices[i + 2];

    const ax = positions[ia * 3],
      ay = positions[ia * 3 + 1],
      az = positions[ia * 3 + 2];
    const bx = positions[ib * 3],
      by = positions[ib * 3 + 1],
      bz = positions[ib * 3 + 2];
    const cx = positions[ic * 3],
      cy = positions[ic * 3 + 1],
      cz = positions[ic * 3 + 2];

    // Edge vectors AB and AC
    const ex = bx - ax,
      ey = by - ay,
      ez = bz - az;
    const fx = cx - ax,
      fy = cy - ay,
      fz = cz - az;

    // Cross product AB × AC
    const nx = ey * fz - ez * fy;
    const ny = ez * fx - ex * fz;
    const nz = ex * fy - ey * fx;

    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    const inv = len > 0 ? 1 / len : 0;
    const nnx = nx * inv,
      nny = ny * inv,
      nnz = nz * inv;

    for (const vi of [ia, ib, ic]) {
      normals[vi * 3] = nnx;
      normals[vi * 3 + 1] = nny;
      normals[vi * 3 + 2] = nnz;
    }
  }

  // --- Per-chunk-column top visible face heights ---
  // For each 32×32-cell XY column inside the 128×128-cell voxel region, track the
  // highest Z reached by any upward-facing visible triangle.  Side walls are
  // ignored so terrain is hidden only when voxel tops actually approach the
  // local surface.
  const chunkTopHeights = new Float32Array(16);
  chunkTopHeights.fill(Number.NEGATIVE_INFINITY);
  const regionWorldSize = 128 * voxelSize;
  const chunkWorldSize = 32 * voxelSize;

  for (let i = 0; i < indexCount; i += 3) {
    const ia = indices[i];
    const ib = indices[i + 1];
    const ic = indices[i + 2];

    // Keep only upward faces (voxel top surfaces).
    if (normals[ia * 3 + 2] <= 0.5) continue;

    const ax = positions[ia * 3],
      ay = positions[ia * 3 + 1],
      az = positions[ia * 3 + 2];
    const bx = positions[ib * 3],
      by = positions[ib * 3 + 1],
      bz = positions[ib * 3 + 2];
    const cx = positions[ic * 3],
      cy = positions[ic * 3 + 1],
      cz = positions[ic * 3 + 2];

    const triTopZ = Math.max(az, bz, cz);

    const localXMin = Math.min(ax, bx, cx) - worldX;
    const localXMax = Math.max(ax, bx, cx) - worldX;
    const localYMin = Math.min(-ay - worldY, -by - worldY, -cy - worldY);
    const localYMax = Math.max(-ay - worldY, -by - worldY, -cy - worldY);

    if (
      localXMax <= 0 ||
      localYMax <= 0 ||
      localXMin >= regionWorldSize ||
      localYMin >= regionWorldSize
    )
      continue;

    const EPS = 1e-4;
    const colX0 = Math.max(0, Math.floor(localXMin / chunkWorldSize));
    const colX1 = Math.min(3, Math.floor((localXMax - EPS) / chunkWorldSize));
    const colY0 = Math.max(0, Math.floor(localYMin / chunkWorldSize));
    const colY1 = Math.min(3, Math.floor((localYMax - EPS) / chunkWorldSize));

    for (let colX = colX0; colX <= colX1; colX++) {
      for (let colY = colY0; colY <= colY1; colY++) {
        const colIndex = colX * 4 + colY;
        if (triTopZ > chunkTopHeights[colIndex]) {
          chunkTopHeights[colIndex] = triTopZ;
        }
      }
    }
  }

  const quadrantTris: number[][] = Array.from({ length: 4 }, () => []);
  for (let i = 0; i < indexCount; i += 3) {
    const ia = indices[i];
    const ib = indices[i + 1];
    const ic = indices[i + 2];

    const ax = positions[ia * 3];
    const ay = positions[ia * 3 + 1];
    const bx = positions[ib * 3];
    const by = positions[ib * 3 + 1];
    const cx = positions[ic * 3];
    const cy = positions[ic * 3 + 1];

    const centerX = (ax + bx + cx) / 3;
    const centerYWorld = -(ay + by + cy) / 3;
    const localX = centerX - worldX;
    const localY = centerYWorld - worldY;
    const quadrantIndex =
      (localX >= regionWorldSize / 2 ? 1 : 0) +
      (localY >= regionWorldSize / 2 ? 2 : 0);
    quadrantTris[quadrantIndex].push(ia, ib, ic);
  }

  const quadrantMeshes = quadrantTris.map((tri, quadrantIndex) => {
    const indexMap = new Map<number, number>();
    const localPos: number[] = [];
    const localNorm: number[] = [];
    const localCol: number[] = [];
    const localIdx: number[] = [];

    for (let i = 0; i < tri.length; i++) {
      const src = tri[i];
      if (src === undefined) continue;
      let dst = indexMap.get(src);
      if (dst === undefined) {
        dst = indexMap.size;
        indexMap.set(src, dst);
        localPos.push(
          positions[src * 3],
          positions[src * 3 + 1],
          positions[src * 3 + 2],
        );
        localNorm.push(
          normals[src * 3],
          normals[src * 3 + 1],
          normals[src * 3 + 2],
        );
        localCol.push(
          colors[src * 3],
          colors[src * 3 + 1],
          colors[src * 3 + 2],
        );
      }
      localIdx.push(dst);
    }

    return {
      quadrantIndex,
      positions: new Float32Array(localPos),
      normals: new Float32Array(localNorm),
      colors: new Float32Array(localCol),
      indices: new Uint32Array(localIdx),
    };
  });

  return {
    quadrantMeshes,
    chunkCoverage,
    chunkTopHeights,
    voxelSize,
    minZ,
    maxZ,
  };
}
