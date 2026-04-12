import {
  DAYLIGHT_MAIN_SUN_POSITION,
  VOXEL_FACE_SHADING,
} from "../lib/daylight.js";
import type { WorkerIn, WorkerOut } from "../lib/types.js";

const MAIN_SUN_DIRECTION = normalizeDirection(DAYLIGHT_MAIN_SUN_POSITION);

/**
 * Off-thread voxel mesh builder.
 *
 * Receives the raw binary ArrayBuffer produced by greedyMeshBinary() on the
 * server (transferred zero-copy from the main thread), decodes it, rebuilds
 * triangle indices from the per-quad winding flags, and computes flat
 * per-face normals. The resulting typed arrays are transferred back to the
 * main thread so Three.js can build the BufferGeometry without any heavy work
 * on the render/event thread.
 *
 * Binary layout (all little-endian):
 *   Header 20 bytes:
 *     i32 worldX, i32 worldY, i32 worldZBase, u32 quadCount, u32 voxelSize
 *   Per-quad color section (quadCount × 3 bytes, padded to 4-byte alignment):
 *     u8 r, u8 g, u8 b per quad
 *   Per-quad winding section (quadCount bytes, padded to 4-byte alignment):
 *     u8 dir per quad: 1 = standard winding, 0 = flipped winding
 *   Per-vertex position section (quadCount × 4 × 4 bytes):
 *     u8 relX, u8 relY, u16 relZ per vertex
 *   The client always rebuilds triangle indices from the winding section.
 */

self.onmessage = (e: MessageEvent<WorkerIn>) => {
  const { buffer, lod, regionX, regionY, version, benchmark } = e.data;
  const workerGlobal = globalThis as unknown as {
    postMessage(message: WorkerOut, transfer?: Transferable[]): void;
  };
  const startedAt = performance.now();

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
    const out: WorkerOut = {
      lod,
      regionX,
      regionY,
      version,
      ...result,
      benchmark: benchmark
        ? {
            fetchMs: benchmark.fetchMs,
            decodeMs: performance.now() - startedAt,
            totalMs: 0,
            transferBytes: benchmark.transferBytes,
            encodedBodyBytes: benchmark.encodedBodyBytes,
            decodedBodyBytes: benchmark.decodedBodyBytes,
            rawBufferBytes: benchmark.rawBufferBytes,
            contentEncoding: benchmark.contentEncoding,
          }
        : undefined,
    };
    workerGlobal.postMessage(out, transferables);
  } catch (err) {
    const out: WorkerOut = {
      regionX,
      regionY,
      lod,
      version,
      benchmark: benchmark
        ? {
            fetchMs: benchmark.fetchMs,
            decodeMs: performance.now() - startedAt,
            totalMs: 0,
            transferBytes: benchmark.transferBytes,
            encodedBodyBytes: benchmark.encodedBodyBytes,
            decodedBodyBytes: benchmark.decodedBodyBytes,
            rawBufferBytes: benchmark.rawBufferBytes,
            contentEncoding: benchmark.contentEncoding,
          }
        : undefined,
      error: err instanceof Error ? err.message : String(err),
    };
    workerGlobal.postMessage(out);
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
  if (buf.byteLength < 20) throw new Error("buffer too small for header");

  const view = new DataView(buf);
  const worldX = view.getInt32(0, true);
  const worldY = view.getInt32(4, true);
  const worldZ = view.getInt32(8, true);
  const quadCount = view.getUint32(12, true);
  const voxelSize = view.getUint32(16, true) || 1;

  const vertexCount = quadCount * 4;

  // Color section: 3 bytes per quad, padded to 4-byte boundary
  const colorPadded = (quadCount * 3 + 3) & ~3;
  const directionPadded = (quadCount + 3) & ~3;
  const expectedSize = 20 + colorPadded + directionPadded + vertexCount * 4;
  if (buf.byteLength < expectedSize) throw new Error("buffer truncated");

  // The server appends a u32 LE chunk-coverage bitmask after the mesh data.
  // If the trailer is absent (stale server cache from before this feature was
  // added), fall back to 0xFFFF: any mesh response implies blocks exist, so
  // terrain should be hidden underneath rather than shown through it.
  const chunkCoverage =
    buf.byteLength >= expectedSize + 4
      ? view.getUint32(expectedSize, true)
      : 0xffff;

  let directionOff = 20 + colorPadded;
  const positionOffset = 20 + colorPadded + directionPadded;

  // --- Positions ---
  const positions = new Float32Array(vertexCount * 3);
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  let off = positionOffset;
  for (let vi = 0; vi < vertexCount; vi++) {
    const rx = view.getUint8(off++);
    const ry = view.getUint8(off++);
    const rz = view.getUint16(off, true);
    off += 2;
    positions[vi * 3] = worldX + rx * voxelSize;
    positions[vi * 3 + 1] = worldY + ry * voxelSize;
    positions[vi * 3 + 2] = worldZ + rz * voxelSize;
    if (positions[vi * 3 + 2] < minZ) minZ = positions[vi * 3 + 2];
    if (positions[vi * 3 + 2] > maxZ) maxZ = positions[vi * 3 + 2];
  }
  if (!Number.isFinite(minZ)) minZ = 0;
  if (!Number.isFinite(maxZ)) maxZ = 0;

  // --- Base colors (per quad, normalized 0–1) ---
  const quadColors = new Float32Array(quadCount * 3);
  let colorOff = 20;
  for (let qi = 0; qi < quadCount; qi++) {
    quadColors[qi * 3] = view.getUint8(colorOff++) / 255;
    quadColors[qi * 3 + 1] = view.getUint8(colorOff++) / 255;
    quadColors[qi * 3 + 2] = view.getUint8(colorOff++) / 255;
  }

  // --- Indices ---
  const resolvedIndexCount = quadCount * 6;
  const indices = new Uint32Array(resolvedIndexCount);
  for (let qi = 0; qi < quadCount; qi++) {
    const base = qi * 4;
    const out = qi * 6;
    const dir = view.getUint8(directionOff++);
    if (dir === 1) {
      indices[out] = base;
      indices[out + 1] = base + 1;
      indices[out + 2] = base + 2;
      indices[out + 3] = base;
      indices[out + 4] = base + 2;
      indices[out + 5] = base + 3;
    } else {
      indices[out] = base;
      indices[out + 1] = base + 2;
      indices[out + 2] = base + 1;
      indices[out + 3] = base;
      indices[out + 4] = base + 3;
      indices[out + 5] = base + 2;
    }
  }

  // --- Flat normals ---
  // Every quad is planar, so each pair of triangles shares one normal.
  // We compute the cross product once per triangle; because both triangles in
  // a quad are coplanar, the second write for each vertex is identical to the
  // first and is simply overwritten with no correctness issue.
  const normals = new Float32Array(vertexCount * 3);
  for (let i = 0; i < resolvedIndexCount; i += 3) {
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

  // --- Colors (per-quad → per-vertex, with a small sun-aware face tint) ---
  // Daytime lighting alone can still leave voxel side faces too close to top-face
  // brightness, so preserve stronger blocky contrast with a modest baked tint.
  const colors = new Float32Array(vertexCount * 3);
  for (let qi = 0; qi < quadCount; qi++) {
    const base = qi * 4;
    const nx = normals[base * 3];
    const ny = normals[base * 3 + 1];
    const nz = normals[base * 3 + 2];
    const tint = getVoxelFaceTint(nx, ny, nz);
    const r = clamp01(quadColors[qi * 3] * tint.r);
    const g = clamp01(quadColors[qi * 3 + 1] * tint.g);
    const b = clamp01(quadColors[qi * 3 + 2] * tint.b);
    for (let v = 0; v < 4; v++) {
      colors[(base + v) * 3] = r;
      colors[(base + v) * 3 + 1] = g;
      colors[(base + v) * 3 + 2] = b;
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

  for (let i = 0; i < resolvedIndexCount; i += 3) {
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
    const localYMin = Math.min(ay, by, cy) - worldY;
    const localYMax = Math.max(ay, by, cy) - worldY;

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
  for (let i = 0; i < resolvedIndexCount; i += 3) {
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
    const centerYWorld = (ay + by + cy) / 3;
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

function getVoxelFaceTint(
  nx: number,
  ny: number,
  nz: number,
): { r: number; g: number; b: number } {
  const sunDot = Math.max(
    0,
    nx * MAIN_SUN_DIRECTION.x +
      ny * MAIN_SUN_DIRECTION.y +
      nz * MAIN_SUN_DIRECTION.z,
  );
  const upDot = Math.max(0, nz);
  const shade = Math.min(
    VOXEL_FACE_SHADING.maxShade,
    VOXEL_FACE_SHADING.base +
      sunDot * VOXEL_FACE_SHADING.sunStrength +
      upDot * VOXEL_FACE_SHADING.upStrength,
  );

  if (nz >= 0.5) {
    return {
      r: shade * VOXEL_FACE_SHADING.topWarmTint.r,
      g: shade * VOXEL_FACE_SHADING.topWarmTint.g,
      b: shade * VOXEL_FACE_SHADING.topWarmTint.b,
    };
  }

  return { r: shade, g: shade, b: shade };
}

function normalizeDirection(vector: { x: number; y: number; z: number }): {
  x: number;
  y: number;
  z: number;
} {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (length === 0) {
    return { x: 0, y: 0, z: 1 };
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
