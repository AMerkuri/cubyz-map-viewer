import {
  DAYLIGHT_MAIN_SUN_POSITION,
  VOXEL_DEPTH_CUE,
  VOXEL_EMITTED_LIGHT,
  VOXEL_FACE_SHADING,
} from "../lib/daylight.js";
import type { EmissiveColorArray, WorkerIn, WorkerOut } from "../lib/types.js";

const MAIN_SUN_DIRECTION = normalizeDirection(DAYLIGHT_MAIN_SUN_POSITION);
const VOXEL_POSITION_FIXED_SCALE = 4096;
const MISSING_BLOCK_PALETTE_INDEX = 0xffff;
const VOXEL_BINARY_MAGIC = 0x354d5856;
const UINT16_EMITTER_VOXEL_BINARY_MAGIC = 0x344d5856;
const PRE_EMITTER_VOXEL_BINARY_MAGIC = 0x334d5856;
const LEGACY_VOXEL_BINARY_MAGIC = 0x324d5856;
const POSITION_KIND_INTEGER = 1;
const GREEDY_RECORD_BYTES = 12;
const MODEL_RECORD_BYTES = 48;
const EMITTER_RECORD_BYTES = 16;
const UINT16_EMITTER_RECORD_BYTES = 14;
const EMITTER_OPEN_FACE_ALL = 0b11_1111;
const EMITTER_OPEN_FACE_X_POS = 1 << 0;
const EMITTER_OPEN_FACE_X_NEG = 1 << 1;
const EMITTER_OPEN_FACE_Y_POS = 1 << 2;
const EMITTER_OPEN_FACE_Y_NEG = 1 << 3;
const EMITTER_OPEN_FACE_Z_POS = 1 << 4;
const EMITTER_OPEN_FACE_Z_NEG = 1 << 5;
const EMITTER_BLOCKED_HORIZONTAL_TRANSMISSION = 0.22;
const EMITTER_BLOCKED_UP_TRANSMISSION = 0.03;
const EMITTER_BLOCKED_DOWN_TRANSMISSION = 0.12;
const MODEL_EMISSIVE_MULTIPLIER = 0.28;
const EMISSIVE_SURFACE_HUE_STRENGTH = 0.42;

// Emissive light values are clamped to 0..1, so they can upload as normalized
// integer attributes. Uint8 quarters the emissive byte cost versus Float32 and
// is the default; set EMISSIVE_ATTRIBUTE_USE_UINT16 to true for finer gradients
// (2x bytes) if visual comparison shows objectionable banding.
const EMISSIVE_ATTRIBUTE_USE_UINT16 = false;
const EMISSIVE_ATTRIBUTE_MAX = EMISSIVE_ATTRIBUTE_USE_UINT16 ? 65535 : 255;

// Cap dense emitter-grid allocation so pathological emitter extents fall back to
// a sparse numeric map instead of allocating an unbounded cell array.
const EMITTER_DENSE_GRID_MAX_CELLS = 1 << 20;

// Above this many overlapped cells, quad culling assumes the quad may receive
// light (false positive) instead of scanning a huge cell volume.
const EMITTER_QUAD_CULL_MAX_CELLS = 4096;

type GreedyFaceCode = 0 | 1 | 2 | 3 | 4 | 5;

interface DecodedQuad {
  positions: number[];
  dir: number;
  color: [number, number, number];
  packedAo: number;
  paletteIndex: number;
  renderKind: 1 | 2;
  sourceKind: "greedy" | "model";
}

interface QuadrantCounts {
  vertices: number;
  indices: number;
  triangles: number;
}

/**
 * Debug/benchmark-only phase metrics for the client emissive bake. These
 * isolate emitter grid construction cost, per-vertex bake cost, and conservative
 * quad culling effectiveness so before/after comparisons can distinguish lookup
 * CPU, culling wins, and transfer-size wins from general decode cost.
 */
interface EmissivePhaseMetrics {
  gridBuildMs: number;
  bakeMs: number;
  quadsEvaluated: number;
  quadsCulled: number;
}

function createEmptyEmissivePhaseMetrics(): EmissivePhaseMetrics {
  return { gridBuildMs: 0, bakeMs: 0, quadsEvaluated: 0, quadsCulled: 0 };
}

/**
 * Spatial index of payload-owned own-region plus halo emitter records used to
 * bake bounded mesh-local emitted-light contribution into per-vertex emissive
 * colors. Cell size is the emitted-light radius so a 3x3x3 neighborhood covers
 * every candidate.
 *
 * The per-vertex hot path avoids string allocation by mapping numeric cell
 * coordinates `(ix, iy, iz)` to emitter buckets. A dense local cell array is
 * used when the emitter extent is bounded; a sparse numeric `Map<number,...>`
 * fallback keeps allocation bounded when extents are pathological.
 */
interface EmitterLightGrid {
  cellSize: number;
  /** Minimum grid cell coordinate along each axis (dense-mode origin). */
  minCellX: number;
  minCellY: number;
  minCellZ: number;
  /** Dense-mode cell counts along each axis (0 when using the sparse map). */
  cellsX: number;
  cellsY: number;
  cellsZ: number;
  /** Dense bucket per cell index, or null when the sparse fallback is active. */
  denseCells: (number[] | undefined)[] | null;
  /** Sparse bucket map keyed by packed numeric cell index, or null in dense mode. */
  sparseCells: Map<number, number[]> | null;
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
  openFaces: Uint8Array;
}

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
 *   Per-quad AO section (quadCount bytes, padded to 4-byte alignment):
 *     u8 packedAo per quad: 2 bits per corner for z+ faces and vertical walls,
 *     0 for faces without AO
 *   Per-quad winding section (quadCount bytes, padded to 4-byte alignment):
 *     u8 dir per quad: 1 = standard winding, 0 = flipped winding
 *   Per-quad palette index section (quadCount × 2 bytes, padded to 4-byte alignment):
 *     u16 save block palette index per quad, 0xFFFF when omitted
 *   Per-quad render-kind section (quadCount bytes, padded to 4-byte alignment):
 *     u8 renderKind per quad: 1 = opaque, 2 = transparent
 *   Per-vertex position section (quadCount × 4 × 12 bytes):
 *     u32 relX, u32 relY, u32 relZ per vertex in 1/4096-cell fixed-point units
 *   The client always rebuilds triangle indices from the winding section.
 */

self.onmessage = (e: MessageEvent<WorkerIn>) => {
  const {
    buffer,
    lod,
    regionX,
    regionY,
    version,
    bakeEmissiveAttributes,
    benchmark,
  } = e.data;
  const workerGlobal = globalThis as unknown as {
    postMessage(message: WorkerOut, transfer?: Transferable[]): void;
  };
  const startedAt = performance.now();

  try {
    const result = buildMeshArrays(buffer, bakeEmissiveAttributes !== false);
    const transferables: Transferable[] = [result.chunkTopHeights.buffer];
    for (const quadrant of result.quadrantMeshes) {
      transferables.push(
        quadrant.positions.buffer,
        quadrant.normals.buffer,
        quadrant.baseColors.buffer,
        quadrant.faceAo.buffer,
        quadrant.trianglePaletteIndices.buffer,
        quadrant.indices.buffer,
      );
      if (quadrant.emissiveColors) {
        transferables.push(quadrant.emissiveColors.buffer);
      }
    }
    for (const quadrant of result.transparentQuadrantMeshes) {
      transferables.push(
        quadrant.positions.buffer,
        quadrant.normals.buffer,
        quadrant.baseColors.buffer,
        quadrant.faceAo.buffer,
        quadrant.trianglePaletteIndices.buffer,
        quadrant.indices.buffer,
      );
    }
    const out: WorkerOut = {
      lod,
      regionX,
      regionY,
      version,
      ...result,
      haloEmitterSourceKeys: [],
      benchmark: benchmark
        ? {
            fetchMs: benchmark.fetchMs,
            decodeMs: performance.now() - startedAt,
            totalMs: 0,
            transferBytes: benchmark.transferBytes,
            encodedBodyBytes: benchmark.encodedBodyBytes,
            decodedBodyBytes: benchmark.decodedBodyBytes,
            rawBufferBytes: benchmark.rawBufferBytes,
            workerOutputBytes: getWorkerOutputBytes(result),
            emissiveBytes: getEmissiveOutputBytes(result),
            emissiveGridBuildMs: result.emissivePhase.gridBuildMs,
            emissiveBakeMs: result.emissivePhase.bakeMs,
            emissiveQuadsEvaluated: result.emissivePhase.quadsEvaluated,
            emissiveQuadsCulled: result.emissivePhase.quadsCulled,
            contentEncoding: benchmark.contentEncoding,
            serverRunMs: benchmark.serverRunMs,
            serverHaloMs: benchmark.serverHaloMs,
            cacheOutcome: benchmark.cacheOutcome,
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
            workerOutputBytes: 0,
            emissiveBytes: 0,
            emissiveGridBuildMs: 0,
            emissiveBakeMs: 0,
            emissiveQuadsEvaluated: 0,
            emissiveQuadsCulled: 0,
            contentEncoding: benchmark.contentEncoding,
            serverRunMs: benchmark.serverRunMs,
            serverHaloMs: benchmark.serverHaloMs,
            cacheOutcome: benchmark.cacheOutcome,
          }
        : undefined,
      error: err instanceof Error ? err.message : String(err),
    };
    workerGlobal.postMessage(out);
  }
};

function getWorkerOutputBytes(
  result: ReturnType<typeof buildMeshArrays>,
): number {
  let bytes = result.chunkTopHeights.byteLength;
  for (const quadrant of [
    ...result.quadrantMeshes,
    ...result.transparentQuadrantMeshes,
  ]) {
    bytes += quadrant.positions.byteLength;
    bytes += quadrant.normals.byteLength;
    bytes += quadrant.baseColors.byteLength;
    bytes += quadrant.emissiveColors?.byteLength ?? 0;
    bytes += quadrant.faceAo.byteLength;
    bytes += quadrant.trianglePaletteIndices.byteLength;
    bytes += quadrant.indices.byteLength;
  }
  return bytes;
}

function getEmissiveOutputBytes(
  result: ReturnType<typeof buildMeshArrays>,
): number {
  let bytes = 0;
  for (const quadrant of [
    ...result.quadrantMeshes,
    ...result.transparentQuadrantMeshes,
  ]) {
    bytes += quadrant.emissiveColors?.byteLength ?? 0;
  }
  return bytes;
}

function buildMeshArrays(
  buf: ArrayBuffer,
  bakeEmissiveAttributes: boolean,
): {
  quadrantMeshes: {
    quadrantIndex: number;
    positions: Float32Array;
    normals: Float32Array;
    baseColors: Float32Array;
    emissiveColors: EmissiveColorArray | null;
    faceAo: Uint8Array;
    trianglePaletteIndices: Uint32Array;
    indices: Uint32Array;
  }[];
  transparentQuadrantMeshes: {
    quadrantIndex: number;
    positions: Float32Array;
    normals: Float32Array;
    baseColors: Float32Array;
    emissiveColors: EmissiveColorArray | null;
    faceAo: Uint8Array;
    trianglePaletteIndices: Uint32Array;
    indices: Uint32Array;
  }[];
  chunkCoverage: number;
  chunkTopHeights: Float32Array;
  voxelSize: number;
  minZ: number;
  maxZ: number;
  emitterRecords: {
    x: number;
    y: number;
    z: number;
    r: number;
    g: number;
    b: number;
    halo?: boolean;
    openFaces?: number;
  }[];
  emissivePhase: EmissivePhaseMetrics;
} {
  if (buf.byteLength < 20) throw new Error("buffer too small for header");

  const view = new DataView(buf);
  if (
    (buf.byteLength >= 36 &&
      (view.getUint32(0, true) === VOXEL_BINARY_MAGIC ||
        view.getUint32(0, true) === UINT16_EMITTER_VOXEL_BINARY_MAGIC)) ||
    (buf.byteLength >= 32 &&
      view.getUint32(0, true) === PRE_EMITTER_VOXEL_BINARY_MAGIC)
  ) {
    return buildOptimizedMeshArrays(
      view,
      buf.byteLength,
      bakeEmissiveAttributes,
    );
  }
  const hasVersionedHeader =
    buf.byteLength >= 24 &&
    view.getUint32(0, true) === LEGACY_VOXEL_BINARY_MAGIC;
  const headerBytes = hasVersionedHeader ? 24 : 20;
  const worldX = view.getInt32(hasVersionedHeader ? 4 : 0, true);
  const worldY = view.getInt32(hasVersionedHeader ? 8 : 4, true);
  const worldZ = view.getInt32(hasVersionedHeader ? 12 : 8, true);
  const quadCount = view.getUint32(hasVersionedHeader ? 16 : 12, true);
  const voxelSize = view.getUint32(hasVersionedHeader ? 20 : 16, true) || 1;

  const vertexCount = quadCount * 4;

  // Color section: 3 bytes per quad, padded to 4-byte boundary
  const colorPadded = (quadCount * 3 + 3) & ~3;
  const aoPadded = (quadCount + 3) & ~3;
  const directionPadded = (quadCount + 3) & ~3;
  const palettePadded = (quadCount * 2 + 3) & ~3;
  const renderKindPadded = (quadCount + 3) & ~3;
  const sourceKindPadded = hasVersionedHeader ? (quadCount + 3) & ~3 : 0;
  const positionKindPadded = hasVersionedHeader ? (quadCount + 3) & ~3 : 0;
  const positionKindOffset =
    headerBytes +
    colorPadded +
    aoPadded +
    directionPadded +
    palettePadded +
    renderKindPadded +
    sourceKindPadded;
  const positionOffset = positionKindOffset + positionKindPadded;
  let positionBytes = vertexCount * 12;
  if (hasVersionedHeader) {
    if (buf.byteLength < positionOffset + positionKindPadded) {
      throw new Error("buffer truncated before voxel position kinds");
    }
    positionBytes = 0;
    for (let qi = 0; qi < quadCount; qi++) {
      const positionKind = view.getUint8(positionKindOffset + qi);
      positionBytes +=
        positionKind === POSITION_KIND_INTEGER ? 4 * 3 * 2 : 4 * 3 * 4;
    }
  }
  const expectedSize =
    headerBytes +
    colorPadded +
    aoPadded +
    directionPadded +
    palettePadded +
    renderKindPadded +
    sourceKindPadded +
    positionKindPadded +
    positionBytes;
  if (buf.byteLength < expectedSize) throw new Error("buffer truncated");

  // The server appends a u32 LE chunk-coverage bitmask after the mesh data.
  // If the trailer is absent (stale server cache from before this feature was
  // added), fall back to 0xFFFF: any mesh response implies blocks exist, so
  // terrain should be hidden underneath rather than shown through it.
  const chunkCoverage =
    buf.byteLength >= expectedSize + 4
      ? view.getUint32(expectedSize, true)
      : 0xffff;

  const aoOffset = headerBytes + colorPadded;
  let directionOff = headerBytes + colorPadded + aoPadded;
  const paletteOffset = headerBytes + colorPadded + aoPadded + directionPadded;
  const renderKindOffset = paletteOffset + palettePadded;

  // --- Positions ---
  const positions = new Float32Array(vertexCount * 3);
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  let off = positionOffset;
  for (let qi = 0; qi < quadCount; qi++) {
    const positionKind = hasVersionedHeader
      ? view.getUint8(positionKindOffset + qi)
      : 2;
    for (let corner = 0; corner < 4; corner++) {
      const vi = qi * 4 + corner;
      let rx: number;
      let ry: number;
      let rz: number;
      if (positionKind === POSITION_KIND_INTEGER) {
        rx = view.getUint16(off, true) * VOXEL_POSITION_FIXED_SCALE;
        off += 2;
        ry = view.getUint16(off, true) * VOXEL_POSITION_FIXED_SCALE;
        off += 2;
        rz = view.getUint16(off, true) * VOXEL_POSITION_FIXED_SCALE;
        off += 2;
      } else {
        rx = view.getUint32(off, true);
        off += 4;
        ry = view.getUint32(off, true);
        off += 4;
        rz = view.getUint32(off, true);
        off += 4;
      }
      positions[vi * 3] =
        worldX + (rx * voxelSize) / VOXEL_POSITION_FIXED_SCALE;
      positions[vi * 3 + 1] =
        worldY + (ry * voxelSize) / VOXEL_POSITION_FIXED_SCALE;
      positions[vi * 3 + 2] =
        worldZ + (rz * voxelSize) / VOXEL_POSITION_FIXED_SCALE;
      if (positions[vi * 3 + 2] < minZ) minZ = positions[vi * 3 + 2];
      if (positions[vi * 3 + 2] > maxZ) maxZ = positions[vi * 3 + 2];
    }
  }
  if (!Number.isFinite(minZ)) minZ = 0;
  if (!Number.isFinite(maxZ)) maxZ = 0;

  // --- Base colors (per quad, normalized 0–1) ---
  const quadColors = new Float32Array(quadCount * 3);
  let colorOff = headerBytes;
  for (let qi = 0; qi < quadCount; qi++) {
    quadColors[qi * 3] = view.getUint8(colorOff++) / 255;
    quadColors[qi * 3 + 1] = view.getUint8(colorOff++) / 255;
    quadColors[qi * 3 + 2] = view.getUint8(colorOff++) / 255;
  }

  const quadAo = new Uint8Array(quadCount);
  let aoOff = aoOffset;
  for (let qi = 0; qi < quadCount; qi++) {
    quadAo[qi] = view.getUint8(aoOff++);
  }

  const quadPaletteIndices = new Uint32Array(quadCount);
  let paletteOff = paletteOffset;
  for (let qi = 0; qi < quadCount; qi++) {
    const paletteIndex = view.getUint16(paletteOff, true);
    paletteOff += 2;
    quadPaletteIndices[qi] =
      paletteIndex === MISSING_BLOCK_PALETTE_INDEX
        ? Number.MAX_SAFE_INTEGER
        : paletteIndex;
  }

  const quadRenderKinds = new Uint8Array(quadCount);
  let renderKindOff = renderKindOffset;
  for (let qi = 0; qi < quadCount; qi++) {
    quadRenderKinds[qi] = view.getUint8(renderKindOff++) === 2 ? 2 : 1;
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

  // --- Colors (per-quad -> per-vertex, with baked depth cues) ---
  // Daytime lighting alone can still leave voxel side faces too close to top-face
  // brightness, so preserve stronger blocky contrast with a modest baked tint
  // and a local top-to-bottom wall gradient on vertical faces.
  const baseColors = new Float32Array(vertexCount * 3);
  const faceAo = new Uint8Array(vertexCount);
  const depthCueRange = Math.max(maxZ - minZ, voxelSize);
  for (let qi = 0; qi < quadCount; qi++) {
    const base = qi * 4;
    const nx = normals[base * 3];
    const ny = normals[base * 3 + 1];
    const nz = normals[base * 3 + 2];
    const tint = getVoxelFaceTint(nx, ny, nz);
    for (let v = 0; v < 4; v++) {
      const vertexIndex = base + v;
      const vertexZ = positions[vertexIndex * 3 + 2];
      const depthCue = getVoxelDepthCue(nz, vertexZ, minZ, depthCueRange);
      baseColors[vertexIndex * 3] = clamp01(
        quadColors[qi * 3] * tint.r * depthCue,
      );
      baseColors[vertexIndex * 3 + 1] = clamp01(
        quadColors[qi * 3 + 1] * tint.g * depthCue,
      );
      baseColors[vertexIndex * 3 + 2] = clamp01(
        quadColors[qi * 3 + 2] * tint.b * depthCue,
      );
      faceAo[vertexIndex] = Math.min(3, (quadAo[qi] >> (v * 2)) & 0b11);
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
    if (quadRenderKinds[Math.floor(i / 6)] === 2) continue;

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
  const transparentQuadrantTris: number[][] = Array.from(
    { length: 4 },
    () => [],
  );
  const quadrantPaletteIndices: number[][] = Array.from(
    { length: 4 },
    () => [],
  );
  const transparentQuadrantPaletteIndices: number[][] = Array.from(
    { length: 4 },
    () => [],
  );
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
    const targetTris =
      quadRenderKinds[Math.floor(i / 6)] === 2
        ? transparentQuadrantTris
        : quadrantTris;
    const targetPaletteIndices =
      quadRenderKinds[Math.floor(i / 6)] === 2
        ? transparentQuadrantPaletteIndices
        : quadrantPaletteIndices;
    targetTris[quadrantIndex].push(ia, ib, ic);
    targetPaletteIndices[quadrantIndex].push(
      quadPaletteIndices[Math.floor(i / 6)] ?? Number.MAX_SAFE_INTEGER,
    );
  }

  const buildQuadrants = (tris: number[][], paletteIndices: number[][]) =>
    tris.map((tri, quadrantIndex) => {
      const triPaletteIndices = paletteIndices[quadrantIndex] ?? [];
      const indexMap = new Map<number, number>();
      const localPos: number[] = [];
      const localNorm: number[] = [];
      const localBaseCol: number[] = [];
      const localFaceAo: number[] = [];
      const localIdx: number[] = [];
      const localTrianglePaletteIndices = new Uint32Array(
        Math.floor(tri.length / 3),
      );

      for (let i = 0; i < tri.length; i += 3) {
        localTrianglePaletteIndices[i / 3] =
          triPaletteIndices[i / 3] ?? Number.MAX_SAFE_INTEGER;
        for (let corner = 0; corner < 3; corner++) {
          const src = tri[i + corner];
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
            localBaseCol.push(
              baseColors[src * 3],
              baseColors[src * 3 + 1],
              baseColors[src * 3 + 2],
            );
            localFaceAo.push(faceAo[src]);
          }
          localIdx.push(dst);
        }
      }

      return {
        quadrantIndex,
        positions: new Float32Array(localPos),
        normals: new Float32Array(localNorm),
        baseColors: new Float32Array(localBaseCol),
        emissiveColors: null,
        faceAo: new Uint8Array(localFaceAo),
        trianglePaletteIndices: localTrianglePaletteIndices,
        indices: new Uint32Array(localIdx),
      };
    });

  const quadrantMeshes = buildQuadrants(quadrantTris, quadrantPaletteIndices);
  const transparentQuadrantMeshes = buildQuadrants(
    transparentQuadrantTris,
    transparentQuadrantPaletteIndices,
  );

  return {
    quadrantMeshes,
    transparentQuadrantMeshes,
    chunkCoverage,
    chunkTopHeights,
    voxelSize,
    minZ,
    maxZ,
    emitterRecords: [],
    emissivePhase: createEmptyEmissivePhaseMetrics(),
  };
}

function buildOptimizedMeshArrays(
  view: DataView,
  byteLength: number,
  bakeEmissiveAttributes: boolean,
): ReturnType<typeof buildMeshArrays> {
  const worldX = view.getInt32(4, true);
  const worldY = view.getInt32(8, true);
  const worldZ = view.getInt32(12, true);
  const quadCount = view.getUint32(16, true);
  const voxelSize = view.getUint32(20, true) || 1;
  const greedyRecordCount = view.getUint32(24, true);
  const modelRecordCount = view.getUint32(28, true);
  const magic = view.getUint32(0, true);
  const hasEmitterHeader =
    magic === VOXEL_BINARY_MAGIC || magic === UINT16_EMITTER_VOXEL_BINARY_MAGIC;
  const emitterRecordBytes =
    magic === UINT16_EMITTER_VOXEL_BINARY_MAGIC
      ? UINT16_EMITTER_RECORD_BYTES
      : EMITTER_RECORD_BYTES;
  const emitterRecordCount = hasEmitterHeader ? view.getUint32(32, true) : 0;
  if (greedyRecordCount + modelRecordCount !== quadCount) {
    throw new Error("voxel payload record counts do not match quad count");
  }

  const colorPadded = (quadCount * 3 + 3) & ~3;
  const aoPadded = (quadCount + 3) & ~3;
  const directionPadded = (quadCount + 3) & ~3;
  const palettePadded = (quadCount * 2 + 3) & ~3;
  const renderKindPadded = (quadCount + 3) & ~3;
  const colorOffset = hasEmitterHeader ? 36 : 32;
  const aoOffset = colorOffset + colorPadded;
  const directionOffset = aoOffset + aoPadded;
  const paletteOffset = directionOffset + directionPadded;
  const renderKindOffset = paletteOffset + palettePadded;
  const greedyRecordOffset = renderKindOffset + renderKindPadded;
  const modelRecordOffset =
    greedyRecordOffset + greedyRecordCount * GREEDY_RECORD_BYTES;
  const emitterRecordOffset =
    modelRecordOffset + modelRecordCount * MODEL_RECORD_BYTES;
  const expectedSize =
    emitterRecordOffset + emitterRecordCount * emitterRecordBytes;
  if (byteLength < expectedSize) {
    throw new Error("buffer truncated before optimized voxel records");
  }

  const chunkCoverage =
    byteLength >= expectedSize + 4
      ? view.getUint32(expectedSize, true)
      : 0xffff;
  const emitterRecords = readEmitterRecords(
    view,
    emitterRecordOffset,
    emitterRecordCount,
    worldX,
    worldY,
    worldZ,
    voxelSize,
    emitterRecordBytes,
  );
  const regionWorldSize = 128 * voxelSize;
  const chunkWorldSize = 32 * voxelSize;
  const chunkTopHeights = new Float32Array(16);
  chunkTopHeights.fill(Number.NEGATIVE_INFINITY);
  const opaqueCounts = createQuadrantCounts();
  const transparentCounts = createQuadrantCounts();
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  forEachOptimizedQuad(
    view,
    quadCount,
    greedyRecordCount,
    worldX,
    worldY,
    worldZ,
    voxelSize,
    colorOffset,
    aoOffset,
    directionOffset,
    paletteOffset,
    renderKindOffset,
    greedyRecordOffset,
    modelRecordOffset,
    (quad) => {
      const normal = computeQuadNormal(quad.positions, quad.dir);
      for (let i = 2; i < quad.positions.length; i += 3) {
        minZ = Math.min(minZ, quad.positions[i] ?? 0);
        maxZ = Math.max(maxZ, quad.positions[i] ?? 0);
      }
      updateChunkTopHeights(
        chunkTopHeights,
        quad.positions,
        normal,
        quad.renderKind,
        worldX,
        worldY,
        regionWorldSize,
        chunkWorldSize,
      );
      const quadrant = getQuadQuadrant(
        quad.positions,
        worldX,
        worldY,
        regionWorldSize,
      );
      const counts = quad.renderKind === 2 ? transparentCounts : opaqueCounts;
      counts[quadrant].vertices += 4;
      counts[quadrant].indices += 6;
      counts[quadrant].triangles += 2;
    },
  );

  if (!Number.isFinite(minZ)) minZ = 0;
  if (!Number.isFinite(maxZ)) maxZ = 0;

  // Mesh-local emitted light stays a bounded client-side approximation:
  // transparent quads keep their existing presentation so glass/water
  // readability is unaffected, and opaque quads accumulate deterministic
  // per-vertex contribution from payload-owned own-region and halo records.
  // Debug-only voxel-lighting diagnostic: when emissive attributes are
  // disabled, skip grid construction so no mesh-local emissive attribute is
  // allocated, baked, transferred, or uploaded. Emitter records are still
  // decoded above for lifecycle/runtime stats.
  const emissivePhase = createEmptyEmissivePhaseMetrics();
  const meshEmitterRecords = emitterRecords;
  const gridBuildStart = performance.now();
  const emitterGrid =
    bakeEmissiveAttributes && meshEmitterRecords.length > 0
      ? buildEmitterLightGrid(meshEmitterRecords)
      : null;
  if (emitterGrid) {
    emissivePhase.gridBuildMs = performance.now() - gridBuildStart;
  }
  const opaqueWriters = createQuadrantWriters(opaqueCounts, emitterGrid);
  const transparentWriters = createQuadrantWriters(transparentCounts, null);
  const depthCueRange = Math.max(maxZ - minZ, voxelSize);
  const bakeStart = emitterGrid ? performance.now() : 0;
  forEachOptimizedQuad(
    view,
    quadCount,
    greedyRecordCount,
    worldX,
    worldY,
    worldZ,
    voxelSize,
    colorOffset,
    aoOffset,
    directionOffset,
    paletteOffset,
    renderKindOffset,
    greedyRecordOffset,
    modelRecordOffset,
    (quad) => {
      const quadrant = getQuadQuadrant(
        quad.positions,
        worldX,
        worldY,
        regionWorldSize,
      );
      const writers =
        quad.renderKind === 2 ? transparentWriters : opaqueWriters;
      // Conservative quad-level culling: opaque quads that cannot intersect any
      // emitter radius skip per-vertex accumulation entirely. Transparent quads
      // never carry emissive attributes, so they are unaffected.
      let bakeEmissiveForQuad = false;
      if (emitterGrid !== null && quad.renderKind !== 2) {
        bakeEmissiveForQuad = quadCanReceiveEmitterLight(
          emitterGrid,
          quad.positions,
        );
        if (bakeEmissiveForQuad) {
          emissivePhase.quadsEvaluated++;
        } else {
          emissivePhase.quadsCulled++;
        }
      }
      writeQuadToQuadrant(
        writers[quadrant],
        quad,
        minZ,
        depthCueRange,
        bakeEmissiveForQuad,
      );
    },
  );
  if (emitterGrid) {
    emissivePhase.bakeMs = performance.now() - bakeStart;
  }

  return {
    quadrantMeshes: opaqueWriters.map(toQuadrantMesh),
    transparentQuadrantMeshes: transparentWriters.map(toQuadrantMesh),
    chunkCoverage,
    chunkTopHeights,
    voxelSize,
    minZ,
    maxZ,
    emitterRecords: emitterRecords.filter((record) => !record.halo),
    emissivePhase,
  };
}

function readEmitterRecords(
  view: DataView,
  offset: number,
  count: number,
  worldX: number,
  worldY: number,
  worldZ: number,
  voxelSize: number,
  recordBytes: number,
): ReturnType<typeof buildMeshArrays>["emitterRecords"] {
  const records: ReturnType<typeof buildMeshArrays>["emitterRecords"] = [];
  let off = offset;
  for (let i = 0; i < count; i++) {
    const x =
      recordBytes === UINT16_EMITTER_RECORD_BYTES
        ? view.getUint16(off, true)
        : view.getInt32(off, true);
    off += recordBytes === UINT16_EMITTER_RECORD_BYTES ? 2 : 4;
    const y =
      recordBytes === UINT16_EMITTER_RECORD_BYTES
        ? view.getUint16(off, true)
        : view.getInt32(off, true);
    off += recordBytes === UINT16_EMITTER_RECORD_BYTES ? 2 : 4;
    const z =
      recordBytes === UINT16_EMITTER_RECORD_BYTES
        ? view.getUint16(off, true)
        : view.getInt32(off, true);
    off += recordBytes === UINT16_EMITTER_RECORD_BYTES ? 2 : 4;
    const r = view.getUint8(off++);
    const g = view.getUint8(off++);
    const b = view.getUint8(off++);
    const flags = view.getUint8(off++);
    off += recordBytes === UINT16_EMITTER_RECORD_BYTES ? 4 : 0;
    records.push({
      x: worldX + (x + 0.5) * voxelSize,
      y: worldY + (y + 0.5) * voxelSize,
      z: worldZ + (z + 0.5) * voxelSize,
      r,
      g,
      b,
      halo: (flags & 1) !== 0,
      openFaces: flags >> 1 || EMITTER_OPEN_FACE_ALL,
    });
  }
  return records;
}

const EMITTER_LIGHT_SCRATCH = new Float32Array(3);

function buildEmitterLightGrid(
  emitterRecords: ReturnType<typeof buildMeshArrays>["emitterRecords"],
): EmitterLightGrid {
  const count = emitterRecords.length;
  const cellSize = VOXEL_EMITTED_LIGHT.radius;

  // Compute the numeric cell extent so dense allocation can be bounded and the
  // hot path can map (ix, iy, iz) to a local array index without string keys.
  let minCellX = Number.POSITIVE_INFINITY;
  let minCellY = Number.POSITIVE_INFINITY;
  let minCellZ = Number.POSITIVE_INFINITY;
  let maxCellX = Number.NEGATIVE_INFINITY;
  let maxCellY = Number.NEGATIVE_INFINITY;
  let maxCellZ = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < count; i++) {
    const record = emitterRecords[i];
    if (!record) continue;
    const ix = Math.floor(record.x / cellSize);
    const iy = Math.floor(record.y / cellSize);
    const iz = Math.floor(record.z / cellSize);
    if (ix < minCellX) minCellX = ix;
    if (iy < minCellY) minCellY = iy;
    if (iz < minCellZ) minCellZ = iz;
    if (ix > maxCellX) maxCellX = ix;
    if (iy > maxCellY) maxCellY = iy;
    if (iz > maxCellZ) maxCellZ = iz;
  }
  if (!Number.isFinite(minCellX)) {
    minCellX = 0;
    minCellY = 0;
    minCellZ = 0;
    maxCellX = -1;
    maxCellY = -1;
    maxCellZ = -1;
  }
  // Pad by one cell on each side so 3x3x3 neighborhood probes stay in bounds.
  const cellsX = Math.max(0, maxCellX - minCellX + 1) + 2;
  const cellsY = Math.max(0, maxCellY - minCellY + 1) + 2;
  const cellsZ = Math.max(0, maxCellZ - minCellZ + 1) + 2;
  const denseCellCount = cellsX * cellsY * cellsZ;
  // Guard against pathological emitter extents: fall back to a sparse numeric
  // map when the dense grid would exceed the bounded cell budget.
  const useDense =
    count > 0 &&
    denseCellCount > 0 &&
    denseCellCount <= EMITTER_DENSE_GRID_MAX_CELLS;

  const grid: EmitterLightGrid = {
    cellSize,
    minCellX: useDense ? minCellX - 1 : 0,
    minCellY: useDense ? minCellY - 1 : 0,
    minCellZ: useDense ? minCellZ - 1 : 0,
    cellsX: useDense ? cellsX : 0,
    cellsY: useDense ? cellsY : 0,
    cellsZ: useDense ? cellsZ : 0,
    denseCells: useDense
      ? new Array<number[] | undefined>(denseCellCount)
      : null,
    sparseCells: useDense ? null : new Map<number, number[]>(),
    x: new Float64Array(count),
    y: new Float64Array(count),
    z: new Float64Array(count),
    r: new Float32Array(count),
    g: new Float32Array(count),
    b: new Float32Array(count),
    openFaces: new Uint8Array(count),
  };
  for (let i = 0; i < count; i++) {
    const record = emitterRecords[i];
    if (!record) continue;
    grid.x[i] = record.x;
    grid.y[i] = record.y;
    grid.z[i] = record.z;
    grid.r[i] = record.r / 255;
    grid.g[i] = record.g / 255;
    grid.b[i] = record.b / 255;
    grid.openFaces[i] = record.openFaces ?? EMITTER_OPEN_FACE_ALL;
    addEmitterToGridCell(
      grid,
      Math.floor(record.x / cellSize),
      Math.floor(record.y / cellSize),
      Math.floor(record.z / cellSize),
      i,
    );
  }
  return grid;
}

/**
 * Returns the local dense array index for a numeric cell coordinate, or -1 when
 * the coordinate lies outside the dense grid bounds. Callers must have a dense
 * grid (`denseCells !== null`).
 */
function denseCellIndex(
  grid: EmitterLightGrid,
  ix: number,
  iy: number,
  iz: number,
): number {
  const lx = ix - grid.minCellX;
  const ly = iy - grid.minCellY;
  const lz = iz - grid.minCellZ;
  if (
    lx < 0 ||
    ly < 0 ||
    lz < 0 ||
    lx >= grid.cellsX ||
    ly >= grid.cellsY ||
    lz >= grid.cellsZ
  ) {
    return -1;
  }
  return (lx * grid.cellsY + ly) * grid.cellsZ + lz;
}

function sparseCellKey(ix: number, iy: number, iz: number): number {
  // Pack signed cell coordinates into a single numeric key using a bounded
  // offset so the sparse fallback avoids string allocation. The offset covers a
  // very large emitter range; collisions across it are not a correctness risk.
  const OFFSET = 1 << 20;
  return (
    (ix + OFFSET) * 4_398_046_511_104 +
    (iy + OFFSET) * 2_097_152 +
    (iz + OFFSET)
  );
}

function addEmitterToGridCell(
  grid: EmitterLightGrid,
  ix: number,
  iy: number,
  iz: number,
  emitterIndex: number,
): void {
  if (grid.denseCells) {
    const index = denseCellIndex(grid, ix, iy, iz);
    if (index < 0) return;
    const cell = grid.denseCells[index];
    if (cell) {
      cell.push(emitterIndex);
    } else {
      grid.denseCells[index] = [emitterIndex];
    }
    return;
  }
  const sparse = grid.sparseCells;
  if (!sparse) return;
  const key = sparseCellKey(ix, iy, iz);
  const cell = sparse.get(key);
  if (cell) {
    cell.push(emitterIndex);
  } else {
    sparse.set(key, [emitterIndex]);
  }
}

function getEmitterGridCell(
  grid: EmitterLightGrid,
  ix: number,
  iy: number,
  iz: number,
): number[] | undefined {
  if (grid.denseCells) {
    const index = denseCellIndex(grid, ix, iy, iz);
    return index < 0 ? undefined : grid.denseCells[index];
  }
  return grid.sparseCells?.get(sparseCellKey(ix, iy, iz));
}

/**
 * Conservative test: can any emitter influence this quad? Uses the quad axis-
 * aligned bounding box expanded by the emitted-light radius and probes the
 * emitter-grid cells overlapping that expanded box. Prefers false positives
 * (keeps existing work) over false negatives (would drop visible light).
 */
function quadCanReceiveEmitterLight(
  grid: EmitterLightGrid,
  positions: number[],
): boolean {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < positions.length; i += 3) {
    const px = positions[i] ?? 0;
    const py = positions[i + 1] ?? 0;
    const pz = positions[i + 2] ?? 0;
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (pz < minZ) minZ = pz;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
    if (pz > maxZ) maxZ = pz;
  }
  const radius = VOXEL_EMITTED_LIGHT.radius;
  const cellSize = grid.cellSize;
  // Expand the quad bounds by the emitted-light radius, then convert to grid
  // cells. Any emitter within radius of the quad lives in one of these cells.
  const cx0 = Math.floor((minX - radius) / cellSize);
  const cy0 = Math.floor((minY - radius) / cellSize);
  const cz0 = Math.floor((minZ - radius) / cellSize);
  const cx1 = Math.floor((maxX + radius) / cellSize);
  const cy1 = Math.floor((maxY + radius) / cellSize);
  const cz1 = Math.floor((maxZ + radius) / cellSize);
  // Very large greedy quads can span many cells; iterating a huge volume would
  // cost more than baking. Prefer a false positive (keep baking) in that case.
  const spanCells = (cx1 - cx0 + 1) * (cy1 - cy0 + 1) * (cz1 - cz0 + 1);
  if (spanCells > EMITTER_QUAD_CULL_MAX_CELLS) return true;
  for (let ix = cx0; ix <= cx1; ix++) {
    for (let iy = cy0; iy <= cy1; iy++) {
      for (let iz = cz0; iz <= cz1; iz++) {
        if (getEmitterGridCell(grid, ix, iy, iz)) return true;
      }
    }
  }
  return false;
}

/**
 * Accumulates bounded emitted-light contribution at a vertex into `out`
 * (r/g/b light factors). Iterates the 3x3x3 grid neighborhood in
 * deterministic payload order, applies a smoothstep falloff with a wrapped
 * lambert term, and clamps per channel so any number of emitters combines
 * without depending on runtime light budgets.
 */
function accumulateEmitterLight(
  grid: EmitterLightGrid,
  x: number,
  y: number,
  z: number,
  normal: [number, number, number],
  out: Float32Array,
): void {
  out[0] = 0;
  out[1] = 0;
  out[2] = 0;
  const radius = VOXEL_EMITTED_LIGHT.radius;
  const radiusSq = radius * radius;
  const wrap = VOXEL_EMITTED_LIGHT.directionalWrap;
  const cx = Math.floor(x / grid.cellSize);
  const cy = Math.floor(y / grid.cellSize);
  const cz = Math.floor(z / grid.cellSize);
  let candidates = 0;
  for (let ix = cx - 1; ix <= cx + 1; ix++) {
    for (let iy = cy - 1; iy <= cy + 1; iy++) {
      for (let iz = cz - 1; iz <= cz + 1; iz++) {
        const cell = getEmitterGridCell(grid, ix, iy, iz);
        if (!cell) continue;
        for (const emitterIndex of cell) {
          if (candidates >= VOXEL_EMITTED_LIGHT.maxCandidatesPerVertex) break;
          candidates++;
          const dx = grid.x[emitterIndex] - x;
          const dy = grid.y[emitterIndex] - y;
          const dz = grid.z[emitterIndex] - z;
          const occlusionTransmission = getEmitterDirectionTransmission(
            grid.openFaces[emitterIndex],
            -dx,
            -dy,
            -dz,
          );
          if (occlusionTransmission <= 0) continue;
          const distSq = dx * dx + dy * dy + dz * dz;
          if (distSq >= radiusSq) continue;
          const dist = Math.sqrt(distSq);
          const t = 1 - dist / radius;
          const falloff = t * t * (3 - 2 * t);
          const lambert =
            dist > 0
              ? Math.max(
                  0,
                  (dx * normal[0] + dy * normal[1] + dz * normal[2]) / dist,
                )
              : 1;
          const weight =
            falloff *
            (wrap + (1 - wrap) * lambert) *
            occlusionTransmission *
            VOXEL_EMITTED_LIGHT.intensity;
          out[0] += grid.r[emitterIndex] * weight;
          out[1] += grid.g[emitterIndex] * weight;
          out[2] += grid.b[emitterIndex] * weight;
        }
      }
    }
  }
  out[0] = Math.min(out[0], VOXEL_EMITTED_LIGHT.maxContribution);
  out[1] = Math.min(out[1], VOXEL_EMITTED_LIGHT.maxContribution);
  out[2] = Math.min(out[2], VOXEL_EMITTED_LIGHT.maxContribution);
}

function getEmitterDirectionTransmission(
  openFaces: number,
  dx: number,
  dy: number,
  dz: number,
): number {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const az = Math.abs(dz);
  const total = ax + ay + az;
  if (total <= 1e-6) return 1;
  return (
    (ax / total) *
      getAxisTransmission(
        openFaces,
        dx >= 0 ? EMITTER_OPEN_FACE_X_POS : EMITTER_OPEN_FACE_X_NEG,
        EMITTER_BLOCKED_HORIZONTAL_TRANSMISSION,
      ) +
    (ay / total) *
      getAxisTransmission(
        openFaces,
        dy >= 0 ? EMITTER_OPEN_FACE_Y_POS : EMITTER_OPEN_FACE_Y_NEG,
        EMITTER_BLOCKED_HORIZONTAL_TRANSMISSION,
      ) +
    (az / total) *
      getAxisTransmission(
        openFaces,
        dz >= 0 ? EMITTER_OPEN_FACE_Z_POS : EMITTER_OPEN_FACE_Z_NEG,
        dz >= 0
          ? EMITTER_BLOCKED_UP_TRANSMISSION
          : EMITTER_BLOCKED_DOWN_TRANSMISSION,
      )
  );
}

function getAxisTransmission(
  openFaces: number,
  faceMask: number,
  blockedTransmission: number,
): number {
  return (openFaces & faceMask) !== 0 ? 1 : blockedTransmission;
}

function forEachOptimizedQuad(
  view: DataView,
  quadCount: number,
  greedyRecordCount: number,
  worldX: number,
  worldY: number,
  worldZ: number,
  voxelSize: number,
  colorOffset: number,
  aoOffset: number,
  directionOffset: number,
  paletteOffset: number,
  renderKindOffset: number,
  greedyRecordOffset: number,
  modelRecordOffset: number,
  visit: (quad: DecodedQuad) => void,
): void {
  for (let qi = 0; qi < quadCount; qi++) {
    const colorOff = colorOffset + qi * 3;
    const paletteIndex = view.getUint16(paletteOffset + qi * 2, true);
    const quad: DecodedQuad = {
      positions:
        qi < greedyRecordCount
          ? readGreedyPositions(
              view,
              greedyRecordOffset + qi * GREEDY_RECORD_BYTES,
              worldX,
              worldY,
              worldZ,
              voxelSize,
            )
          : readModelPositions(
              view,
              modelRecordOffset + (qi - greedyRecordCount) * MODEL_RECORD_BYTES,
              worldX,
              worldY,
              worldZ,
              voxelSize,
            ),
      dir: view.getUint8(directionOffset + qi),
      color: [
        view.getUint8(colorOff) / 255,
        view.getUint8(colorOff + 1) / 255,
        view.getUint8(colorOff + 2) / 255,
      ],
      packedAo: view.getUint8(aoOffset + qi),
      paletteIndex:
        paletteIndex === MISSING_BLOCK_PALETTE_INDEX
          ? Number.MAX_SAFE_INTEGER
          : paletteIndex,
      renderKind: view.getUint8(renderKindOffset + qi) === 2 ? 2 : 1,
      sourceKind: qi < greedyRecordCount ? "greedy" : "model",
    };
    visit(quad);
  }
}

function readGreedyPositions(
  view: DataView,
  off: number,
  worldX: number,
  worldY: number,
  worldZ: number,
  voxelSize: number,
): number[] {
  const face = view.getUint8(off) as GreedyFaceCode;
  const plane = view.getUint16(off + 2, true);
  const u = view.getUint16(off + 4, true);
  const v = view.getUint16(off + 6, true);
  const du = view.getUint16(off + 8, true);
  const dv = view.getUint16(off + 10, true);
  const x = (value: number) => worldX + value * voxelSize;
  const y = (value: number) => worldY + value * voxelSize;
  const z = (value: number) => worldZ + value * voxelSize;
  switch (face) {
    case 0:
    case 1:
      return [
        x(plane),
        y(u),
        z(v),
        x(plane),
        y(u + du),
        z(v),
        x(plane),
        y(u + du),
        z(v + dv),
        x(plane),
        y(u),
        z(v + dv),
      ];
    case 2:
    case 3:
      return [
        x(u),
        y(plane),
        z(v),
        x(u + du),
        y(plane),
        z(v),
        x(u + du),
        y(plane),
        z(v + dv),
        x(u),
        y(plane),
        z(v + dv),
      ];
    case 4:
    case 5:
      return [
        x(u),
        y(v),
        z(plane),
        x(u + du),
        y(v),
        z(plane),
        x(u + du),
        y(v + dv),
        z(plane),
        x(u),
        y(v + dv),
        z(plane),
      ];
  }
}

function readModelPositions(
  view: DataView,
  offset: number,
  worldX: number,
  worldY: number,
  worldZ: number,
  voxelSize: number,
): number[] {
  const positions: number[] = [];
  let off = offset;
  for (let corner = 0; corner < 4; corner++) {
    const rx = view.getUint32(off, true);
    off += 4;
    const ry = view.getUint32(off, true);
    off += 4;
    const rz = view.getUint32(off, true);
    off += 4;
    positions.push(
      worldX + (rx * voxelSize) / VOXEL_POSITION_FIXED_SCALE,
      worldY + (ry * voxelSize) / VOXEL_POSITION_FIXED_SCALE,
      worldZ + (rz * voxelSize) / VOXEL_POSITION_FIXED_SCALE,
    );
  }
  return positions;
}

function createQuadrantCounts(): QuadrantCounts[] {
  return Array.from({ length: 4 }, () => ({
    vertices: 0,
    indices: 0,
    triangles: 0,
  }));
}

function createEmissiveColorArray(vertexCount: number): EmissiveColorArray {
  return EMISSIVE_ATTRIBUTE_USE_UINT16
    ? new Uint16Array(vertexCount * 3)
    : new Uint8Array(vertexCount * 3);
}

function createQuadrantWriters(
  counts: QuadrantCounts[],
  emitterGrid: EmitterLightGrid | null,
) {
  return counts.map((count, quadrantIndex) => ({
    quadrantIndex,
    positions: new Float32Array(count.vertices * 3),
    normals: new Float32Array(count.vertices * 3),
    baseColors: new Float32Array(count.vertices * 3),
    // Emissive output is allocated lazily only after a vertex in this quadrant
    // receives a non-zero contribution, so unlit quadrants transfer no attribute.
    emissiveColors: null as EmissiveColorArray | null,
    emitterGrid,
    vertexCount: count.vertices,
    hasEmissive: false,
    faceAo: new Uint8Array(count.vertices),
    trianglePaletteIndices: new Uint32Array(count.triangles),
    indices: new Uint32Array(count.indices),
    vertexOffset: 0,
    indexOffset: 0,
    triangleOffset: 0,
  }));
}

function toQuadrantMesh(
  writer: ReturnType<typeof createQuadrantWriters>[number],
) {
  return {
    quadrantIndex: writer.quadrantIndex,
    positions: writer.positions,
    normals: writer.normals,
    baseColors: writer.baseColors,
    emissiveColors: writer.hasEmissive ? writer.emissiveColors : null,
    faceAo: writer.faceAo,
    trianglePaletteIndices: writer.trianglePaletteIndices,
    indices: writer.indices,
  };
}

function writeQuadToQuadrant(
  writer: ReturnType<typeof createQuadrantWriters>[number],
  quad: DecodedQuad,
  minZ: number,
  depthCueRange: number,
  bakeEmissive: boolean,
): void {
  const normal = computeQuadNormal(quad.positions, quad.dir);
  const tint = getVoxelFaceTint(normal[0], normal[1], normal[2]);
  const baseVertex = writer.vertexOffset;
  const emissiveMultiplier =
    quad.sourceKind === "model" ? MODEL_EMISSIVE_MULTIPLIER : 1;
  for (let v = 0; v < 4; v++) {
    const src = v * 3;
    const dst = (baseVertex + v) * 3;
    const vertexZ = quad.positions[src + 2] ?? 0;
    const depthCue = getVoxelDepthCue(normal[2], vertexZ, minZ, depthCueRange);
    writer.positions[dst] = quad.positions[src] ?? 0;
    writer.positions[dst + 1] = quad.positions[src + 1] ?? 0;
    writer.positions[dst + 2] = vertexZ;
    writer.normals[dst] = normal[0];
    writer.normals[dst + 1] = normal[1];
    writer.normals[dst + 2] = normal[2];
    writer.baseColors[dst] = clamp01(quad.color[0] * tint.r * depthCue);
    writer.baseColors[dst + 1] = clamp01(quad.color[1] * tint.g * depthCue);
    writer.baseColors[dst + 2] = clamp01(quad.color[2] * tint.b * depthCue);
    if (bakeEmissive && writer.emitterGrid) {
      accumulateEmitterLight(
        writer.emitterGrid,
        quad.positions[src] ?? 0,
        quad.positions[src + 1] ?? 0,
        vertexZ,
        normal,
        EMITTER_LIGHT_SCRATCH,
      );
      if (
        EMITTER_LIGHT_SCRATCH[0] > 0 ||
        EMITTER_LIGHT_SCRATCH[1] > 0 ||
        EMITTER_LIGHT_SCRATCH[2] > 0
      ) {
        // Bias the emitted radiance toward the receiving block's own hue so
        // local light brightens terrain without washing surfaces toward white.
        const baseR = writer.baseColors[dst];
        const baseG = writer.baseColors[dst + 1];
        const baseB = writer.baseColors[dst + 2];
        const baseMax = Math.max(baseR, baseG, baseB, 1e-6);
        const hueR =
          1 -
          EMISSIVE_SURFACE_HUE_STRENGTH +
          EMISSIVE_SURFACE_HUE_STRENGTH * (baseR / baseMax);
        const hueG =
          1 -
          EMISSIVE_SURFACE_HUE_STRENGTH +
          EMISSIVE_SURFACE_HUE_STRENGTH * (baseG / baseMax);
        const hueB =
          1 -
          EMISSIVE_SURFACE_HUE_STRENGTH +
          EMISSIVE_SURFACE_HUE_STRENGTH * (baseB / baseMax);
        // Lazily allocate the emissive output only once a vertex is actually
        // lit, then encode the clamped 0..1 value as a normalized integer.
        let emissiveColors = writer.emissiveColors;
        if (!emissiveColors) {
          emissiveColors = createEmissiveColorArray(writer.vertexCount);
          writer.emissiveColors = emissiveColors;
          writer.hasEmissive = true;
        }
        emissiveColors[dst] = encodeEmissiveChannel(
          baseR * EMITTER_LIGHT_SCRATCH[0] * hueR * emissiveMultiplier,
        );
        emissiveColors[dst + 1] = encodeEmissiveChannel(
          baseG * EMITTER_LIGHT_SCRATCH[1] * hueG * emissiveMultiplier,
        );
        emissiveColors[dst + 2] = encodeEmissiveChannel(
          baseB * EMITTER_LIGHT_SCRATCH[2] * hueB * emissiveMultiplier,
        );
      }
    }
    writer.faceAo[baseVertex + v] = Math.min(
      3,
      (quad.packedAo >> (v * 2)) & 0b11,
    );
  }
  const indexBase = writer.indexOffset;
  if (quad.dir === 1) {
    writer.indices.set(
      [
        baseVertex,
        baseVertex + 1,
        baseVertex + 2,
        baseVertex,
        baseVertex + 2,
        baseVertex + 3,
      ],
      indexBase,
    );
  } else {
    writer.indices.set(
      [
        baseVertex,
        baseVertex + 2,
        baseVertex + 1,
        baseVertex,
        baseVertex + 3,
        baseVertex + 2,
      ],
      indexBase,
    );
  }
  writer.trianglePaletteIndices[writer.triangleOffset] = quad.paletteIndex;
  writer.trianglePaletteIndices[writer.triangleOffset + 1] = quad.paletteIndex;
  writer.vertexOffset += 4;
  writer.indexOffset += 6;
  writer.triangleOffset += 2;
}

function computeQuadNormal(
  positions: number[],
  dir: number,
): [number, number, number] {
  const ia = 0;
  const ib = dir === 1 ? 3 : 6;
  const ic = dir === 1 ? 6 : 3;
  const ex = (positions[ib] ?? 0) - (positions[ia] ?? 0);
  const ey = (positions[ib + 1] ?? 0) - (positions[ia + 1] ?? 0);
  const ez = (positions[ib + 2] ?? 0) - (positions[ia + 2] ?? 0);
  const fx = (positions[ic] ?? 0) - (positions[ia] ?? 0);
  const fy = (positions[ic + 1] ?? 0) - (positions[ia + 1] ?? 0);
  const fz = (positions[ic + 2] ?? 0) - (positions[ia + 2] ?? 0);
  const nx = ey * fz - ez * fy;
  const ny = ez * fx - ex * fz;
  const nz = ex * fy - ey * fx;
  const length = Math.hypot(nx, ny, nz);
  if (length === 0) return [0, 0, 0];
  return [nx / length, ny / length, nz / length];
}

function getQuadQuadrant(
  positions: number[],
  worldX: number,
  worldY: number,
  regionWorldSize: number,
): number {
  const centerX =
    ((positions[0] ?? 0) + (positions[3] ?? 0) + (positions[6] ?? 0)) / 3;
  const centerY =
    ((positions[1] ?? 0) + (positions[4] ?? 0) + (positions[7] ?? 0)) / 3;
  const localX = centerX - worldX;
  const localY = centerY - worldY;
  return (
    (localX >= regionWorldSize / 2 ? 1 : 0) +
    (localY >= regionWorldSize / 2 ? 2 : 0)
  );
}

function updateChunkTopHeights(
  chunkTopHeights: Float32Array,
  positions: number[],
  normal: [number, number, number],
  renderKind: 1 | 2,
  worldX: number,
  worldY: number,
  regionWorldSize: number,
  chunkWorldSize: number,
): void {
  if (normal[2] <= 0.5 || renderKind === 2) return;
  for (const tri of [
    [0, 1, 2],
    [0, 2, 3],
  ] as const) {
    const ax = positions[tri[0] * 3] ?? 0;
    const ay = positions[tri[0] * 3 + 1] ?? 0;
    const az = positions[tri[0] * 3 + 2] ?? 0;
    const bx = positions[tri[1] * 3] ?? 0;
    const by = positions[tri[1] * 3 + 1] ?? 0;
    const bz = positions[tri[1] * 3 + 2] ?? 0;
    const cx = positions[tri[2] * 3] ?? 0;
    const cy = positions[tri[2] * 3 + 1] ?? 0;
    const cz = positions[tri[2] * 3 + 2] ?? 0;
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
    const eps = 1e-4;
    const colX0 = Math.max(0, Math.floor(localXMin / chunkWorldSize));
    const colX1 = Math.min(3, Math.floor((localXMax - eps) / chunkWorldSize));
    const colY0 = Math.max(0, Math.floor(localYMin / chunkWorldSize));
    const colY1 = Math.min(3, Math.floor((localYMax - eps) / chunkWorldSize));
    const triTopZ = Math.max(az, bz, cz);
    for (let colX = colX0; colX <= colX1; colX++) {
      for (let colY = colY0; colY <= colY1; colY++) {
        const index = colX * 4 + colY;
        if (triTopZ > chunkTopHeights[index]) chunkTopHeights[index] = triTopZ;
      }
    }
  }
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

function getVoxelDepthCue(
  nz: number,
  vertexZ: number,
  minZ: number,
  depthCueRange: number,
): number {
  if (Math.abs(nz) >= 0.5 || depthCueRange <= 0) {
    return 1;
  }

  const t = smoothstep(clamp01((vertexZ - minZ) / depthCueRange));
  return lerp(VOXEL_DEPTH_CUE.sideBottom, VOXEL_DEPTH_CUE.sideTop, t);
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

/**
 * Encodes a clamped 0..1 emissive channel into a normalized integer sample that
 * uploads as a normalized `BufferAttribute` (so the shader still reads 0..1).
 */
function encodeEmissiveChannel(value: number): number {
  return Math.round(clamp01(value) * EMISSIVE_ATTRIBUTE_MAX);
}

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}
