/**
 * Greedy meshing service.
 * Converts a 3D block array into an optimized triangle mesh by merging
 * adjacent same-color faces into larger quads (greedy meshing).
 *
 * Coordinate convention (matches Three.js scene):
 *   x = world X, y = world Y, z = world Z (up)
 * The client negates Y when placing geometry, so this module outputs
 * raw world coords; Y-negation and winding correction happen client-side.
 *
 * Two output modes:
 *   greedyMesh()       – JSON-serialisable object (kept for reference)
 *   greedyMeshBinary() – compact ArrayBuffer wire format (preferred)
 *
 * Binary layout
 * ─────────────
 * Header (24 bytes)
 *   i32  worldX
 *   i32  worldY
 *   i32  worldZBase
 *   u32  quadCount
 *   u32  indexCount
 *   u32  voxelSize
 *
 * Per-quad colors  (3 × quadCount bytes, padded to 4-byte alignment)
 *   u8 r, u8 g, u8 b   — one entry per quad (client expands to 4 vertices)
 *
 * Per-vertex positions  (4 × quadCount × 4 bytes)
 *   u8  x   relative to worldX  (0–127)
 *   u8  y   relative to worldY  (0–127)
 *   u16 z   relative to worldZBase (0–65535, little-endian)
 *
 * Indices  (4 × indexCount bytes, u32[])
 *
 * Trailer (4 bytes)
 *   u32 chunkCoverage  — 16-bit bitmask, bit (cx*4+cy) set when the 32×32
 *                        chunk column at local offset (cx*32, cy*32) contains
 *                        at least one non-air block.  The upper 16 bits are
 *                        always zero.  0xFFFF = all 16 columns covered.
 */

import type { BlockColorTable } from "./block-color-table.js";

export interface BinaryQuad {
  v0x: number;
  v0y: number;
  v0z: number;
  v1x: number;
  v1y: number;
  v1z: number;
  v2x: number;
  v2y: number;
  v2z: number;
  v3x: number;
  v3y: number;
  v3z: number;
  typ: number;
  dir: number;
}

export interface VoxelMeshData {
  /** Flat array of vertex positions: [x0,y0,z0, x1,y1,z1, ...] */
  positions: number[];
  /** Flat array of per-vertex RGB colors, 0-255: [r0,g0,b0, r1,g1,b1, ...] */
  colors: number[];
  /** Triangle index array: every 3 values define one triangle */
  indices: number[];
  /** World coordinate of the (0,0,0) corner of this voxel column */
  worldX: number;
  worldY: number;
}

/** Width/depth of one voxel region column in world blocks (4 chunks × 32 = 128) */
export const VOXEL_REGION_SIZE = 128;
const CHUNK_COLUMN_SIZE = 32;

/**
 * Run greedy meshing on a dense 3D block array.
 *
 * @param blockTypes  Uint16Array of block palette indices, indexed as
 *                    [x * depth * height + y * height + z].
 *                    Index 0 is air and is transparent (no faces emitted).
 * @param width       Number of blocks in X (= VOXEL_REGION_SIZE)
 * @param depth       Number of blocks in Y (= VOXEL_REGION_SIZE)
 * @param height      Number of blocks in Z
 * @param worldX      World X of the (0,0,0) corner
 * @param worldY      World Y of the (0,0,0) corner
 * @param worldZ      World Z of the bottom of this column
 * @param colorMap    Service used to look up block palette index -> RGB
 */
export function greedyMesh(
  blockTypes: Uint16Array,
  width: number,
  depth: number,
  height: number,
  worldX: number,
  worldY: number,
  worldZ: number,
  blockColors: BlockColorTable,
): VoxelMeshData {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  function getBlock(x: number, y: number, z: number): number {
    if (x < 0 || x >= width || y < 0 || y >= depth || z < 0 || z >= height) {
      return 0; // air outside bounds
    }
    return blockTypes[x * depth * height + y * height + z];
  }

  function isOpaque(x: number, y: number, z: number): boolean {
    return getBlock(x, y, z) !== 0;
  }

  function cellsUntilChunkBoundary(coord: number): number {
    return CHUNK_COLUMN_SIZE - (coord % CHUNK_COLUMN_SIZE);
  }

  function addQuad(
    // Four corners of the quad (world coords), CCW from the outside face
    v0x: number, v0y: number, v0z: number,
    v1x: number, v1y: number, v1z: number,
    v2x: number, v2y: number, v2z: number,
    v3x: number, v3y: number, v3z: number,
    r: number, g: number, b: number,
    // dir=+1 → standard winding, dir=-1 → flipped
    dir: number,
  ) {
    const base = positions.length / 3;

    positions.push(
      worldX + v0x, worldY + v0y, worldZ + v0z,
      worldX + v1x, worldY + v1y, worldZ + v1z,
      worldX + v2x, worldY + v2y, worldZ + v2z,
      worldX + v3x, worldY + v3y, worldZ + v3z,
    );
    for (let i = 0; i < 4; i++) {
      colors.push(r, g, b);
    }

    if (dir === 1) {
      // CCW: (0,1,2) and (0,2,3)
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    } else {
      // Flipped: (0,2,1) and (0,3,2)
      indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
  }

  // --- X faces (normal along X axis) ---
  // For each YZ slice at x=i, emit quads for faces visible in +X or -X direction.
  for (let dir = -1; dir <= 1; dir += 2) {
    // mask[y * height + z] = block type of visible face, 0 = no face
    const mask = new Int32Array(depth * height);

    for (let x = 0; x < width; x++) {
      // Fill mask: face visible if current block is opaque and neighbour in dir is air
      for (let y = 0; y < depth; y++) {
        for (let z = 0; z < height; z++) {
          const here = isOpaque(x, y, z);
          const nx = x + dir;
          const neighbourOpaque = isOpaque(nx, y, z);
          if (here && !neighbourOpaque) {
            mask[y * height + z] = getBlock(x, y, z);
          } else {
            mask[y * height + z] = 0;
          }
        }
      }

      // Greedy merge in YZ plane
      const used = new Uint8Array(depth * height);
      for (let y = 0; y < depth; y++) {
        for (let z = 0; z < height; z++) {
          const typ = mask[y * height + z];
          if (typ === 0 || used[y * height + z]) continue;

          // Extend in Z first
          let dz = 1;
          while (z + dz < height && mask[y * height + z + dz] === typ && !used[y * height + z + dz]) {
            dz++;
          }
          // Extend in Y
          const maxDy = Math.min(depth - y, cellsUntilChunkBoundary(y));
          let dy = 1;
          outer: while (dy < maxDy) {
            for (let k = 0; k < dz; k++) {
              if (mask[(y + dy) * height + z + k] !== typ || used[(y + dy) * height + z + k]) {
                break outer;
              }
            }
            dy++;
          }

          // Mark used
          for (let py = 0; py < dy; py++) {
            for (let pz = 0; pz < dz; pz++) {
              used[(y + py) * height + z + pz] = 1;
            }
          }

          const rgb = getBlockColor(blockColors, typ);
          // Face at x + (dir===1 ? 1 : 0) in world space
          const fx = dir === 1 ? x + 1 : x;

          // Four corners. For +X face: normal points in +X.
          // CCW from outside (+X dir): (fx, y, z) → (fx, y+dy, z) → (fx, y+dy, z+dz) → (fx, y, z+dz)
          // For -X dir: flip to maintain outward normals.
          addQuad(
            fx, y,      z,
            fx, y + dy, z,
            fx, y + dy, z + dz,
            fx, y,      z + dz,
            rgb.r, rgb.g, rgb.b,
            dir,
          );
        }
      }
    }
  }

  // --- Y faces (normal along Y axis) ---
  for (let dir = -1; dir <= 1; dir += 2) {
    const mask = new Int32Array(width * height);

    for (let y = 0; y < depth; y++) {
      for (let x = 0; x < width; x++) {
        for (let z = 0; z < height; z++) {
          const here = isOpaque(x, y, z);
          const ny = y + dir;
          const neighbourOpaque = isOpaque(x, ny, z);
          if (here && !neighbourOpaque) {
            mask[x * height + z] = getBlock(x, y, z);
          } else {
            mask[x * height + z] = 0;
          }
        }
      }

      const used = new Uint8Array(width * height);
      for (let x = 0; x < width; x++) {
        for (let z = 0; z < height; z++) {
          const typ = mask[x * height + z];
          if (typ === 0 || used[x * height + z]) continue;

          let dz = 1;
          while (z + dz < height && mask[x * height + z + dz] === typ && !used[x * height + z + dz]) {
            dz++;
          }
          const maxDx = Math.min(width - x, cellsUntilChunkBoundary(x));
          let dx = 1;
          outer: while (dx < maxDx) {
            for (let k = 0; k < dz; k++) {
              if (mask[(x + dx) * height + z + k] !== typ || used[(x + dx) * height + z + k]) {
                break outer;
              }
            }
            dx++;
          }

          for (let px = 0; px < dx; px++) {
            for (let pz = 0; pz < dz; pz++) {
              used[(x + px) * height + z + pz] = 1;
            }
          }

          const rgb = getBlockColor(blockColors, typ);
          const fy = dir === 1 ? y + 1 : y;

          // Y-faces: all vertices share the same Y, so client-side Y-negation
          // does NOT reverse their winding (unlike X/Z faces where Y varies).
          // The client still applies the unconditional b↔c swap, so we must
          // pre-invert here to cancel it out.
          addQuad(
            x,      fy, z,
            x + dx, fy, z,
            x + dx, fy, z + dz,
            x,      fy, z + dz,
            rgb.r, rgb.g, rgb.b,
            -dir,
          );
        }
      }
    }
  }

  // --- Z faces (normal along Z axis / up-down) ---
  for (let dir = -1; dir <= 1; dir += 2) {
    const mask = new Int32Array(width * depth);

    for (let z = 0; z < height; z++) {
      for (let x = 0; x < width; x++) {
        for (let y = 0; y < depth; y++) {
          const here = isOpaque(x, y, z);
          const nz = z + dir;
          const neighbourOpaque = isOpaque(x, y, nz);
          if (here && !neighbourOpaque) {
            mask[x * depth + y] = getBlock(x, y, z);
          } else {
            mask[x * depth + y] = 0;
          }
        }
      }

      const used = new Uint8Array(width * depth);
      for (let x = 0; x < width; x++) {
        for (let y = 0; y < depth; y++) {
          const typ = mask[x * depth + y];
          if (typ === 0 || used[x * depth + y]) continue;

          const maxDy = Math.min(depth - y, cellsUntilChunkBoundary(y));
          let dy = 1;
          while (dy < maxDy && mask[x * depth + y + dy] === typ && !used[x * depth + y + dy]) {
            dy++;
          }
          const maxDx = Math.min(width - x, cellsUntilChunkBoundary(x));
          let dx = 1;
          outer: while (dx < maxDx) {
            for (let k = 0; k < dy; k++) {
              if (mask[(x + dx) * depth + y + k] !== typ || used[(x + dx) * depth + y + k]) {
                break outer;
              }
            }
            dx++;
          }

          for (let px = 0; px < dx; px++) {
            for (let py = 0; py < dy; py++) {
              used[(x + px) * depth + y + py] = 1;
            }
          }

          const rgb = getBlockColor(blockColors, typ);
          const fz = dir === 1 ? z + 1 : z;

          addQuad(
            x,      y,      fz,
            x + dx, y,      fz,
            x + dx, y + dy, fz,
            x,      y + dy, fz,
            rgb.r, rgb.g, rgb.b,
            dir,
          );
        }
      }
    }
  }

  return { positions, colors, indices, worldX, worldY };
}

/**
 * Compact binary greedy mesh — same algorithm as greedyMesh() but:
 *   - Skips bottom (−Z) faces: never visible from above in a map viewer
 *   - Per-quad (not per-vertex) colors — client expands 1→4 vertices
 *   - Positions stored as relative u8 XY + u16 Z offsets from worldX/Y/Z
 *   - Returns an ArrayBuffer ready to send as application/octet-stream
 *   - Preserves 32×32 internal chunk-column boundaries so the client can
 *     independently cull parent/child LOD columns without geometry overlap
 *
 * See module docblock for the exact binary layout.
 */
export function greedyMeshBinary(
  blockTypes: Uint16Array,
  width: number,
  depth: number,
  height: number,
  worldX: number,
  worldY: number,
  worldZ: number,
  voxelSize: number,
  blockColors: BlockColorTable,
  exteriorAirMask?: Uint32Array,
  surfaceHeights?: Int32Array,
): ArrayBuffer {
  // Accumulate quads into typed arrays, doubling capacity as needed.
  // Each quad: 3 color bytes + 4 vertices × (u8 x, u8 y, u16 z) = 3 + 16 = 19 bytes
  // Plus 6 indices × 4 bytes = 24 bytes per quad.
  let capacity = 4096;
  let quadCount = 0;

  // Per-quad: r, g, b
  let quadColors = new Uint8Array(capacity * 3);
  // Per-vertex (4 per quad): x (u8), y (u8), z_lo (u8), z_hi (u8)
  let vertPosX = new Uint8Array(capacity * 4);
  let vertPosY = new Uint8Array(capacity * 4);
  let vertPosZ = new Uint16Array(capacity * 4);
  // 6 indices per quad
  let indexBuf = new Uint32Array(capacity * 6);

  function ensureCapacity() {
    if (quadCount < capacity) return;
    capacity *= 2;
    const qc2 = new Uint8Array(capacity * 3);
    qc2.set(quadColors);
    quadColors = qc2;
    const vx2 = new Uint8Array(capacity * 4);
    vx2.set(vertPosX);
    vertPosX = vx2;
    const vy2 = new Uint8Array(capacity * 4);
    vy2.set(vertPosY);
    vertPosY = vy2;
    const vz2 = new Uint16Array(capacity * 4);
    vz2.set(vertPosZ);
    vertPosZ = vz2;
    const ib2 = new Uint32Array(capacity * 6);
    ib2.set(indexBuf);
    indexBuf = ib2;
  }

  function getBlock(x: number, y: number, z: number): number {
    if (x < 0 || x >= width || y < 0 || y >= depth || z < 0 || z >= height) return 0;
    return blockTypes[x * depth * height + y * height + z];
  }

  function isOpaque(x: number, y: number, z: number): boolean {
    return getBlock(x, y, z) !== 0;
  }

  function isExteriorAir(x: number, y: number, z: number): boolean {
    if (z >= height) {
      return x >= 0 && x < width && y >= 0 && y < depth;
    }
    if (x < 0 || x >= width || y < 0 || y >= depth || z < 0) {
      return false;
    }
    const flatIndex = x * depth * height + y * height + z;
    if (blockTypes[flatIndex] !== 0) return false;
    if (!exteriorAirMask) return true;
    return (exteriorAirMask[flatIndex >>> 5] & (1 << (flatIndex & 31))) !== 0;
  }

  function shouldIncludeBlock(x: number, y: number, z: number): boolean {
    if (!isOpaque(x, y, z)) return false;
    if (!surfaceHeights) return true;
    const worldCellTopZ = worldZ + (z + 1) * voxelSize;
    return worldCellTopZ > surfaceHeights[x * depth + y];
  }

  function isVisibleSolid(x: number, y: number, z: number): boolean {
    return shouldIncludeBlock(x, y, z);
  }

  function cellsUntilChunkBoundary(coord: number): number {
    return CHUNK_COLUMN_SIZE - (coord % CHUNK_COLUMN_SIZE);
  }

  /**
   * Emit one quad. Vertices are given as local coords (relative to worldX/Y/Z).
   * dir=+1 → CCW winding, dir=-1 → flipped.
   */
  function addQuad(
    v0x: number, v0y: number, v0z: number,
    v1x: number, v1y: number, v1z: number,
    v2x: number, v2y: number, v2z: number,
    v3x: number, v3y: number, v3z: number,
    r: number, g: number, b: number,
    dir: number,
  ) {
    ensureCapacity();

    const qi = quadCount;
    const vi = qi * 4;   // first vertex slot for this quad
    const ii = qi * 6;   // first index slot for this quad
    const baseVert = vi; // vertex index referenced by indices

    quadColors[qi * 3]     = r;
    quadColors[qi * 3 + 1] = g;
    quadColors[qi * 3 + 2] = b;

    vertPosX[vi]     = v0x; vertPosY[vi]     = v0y; vertPosZ[vi]     = v0z;
    vertPosX[vi + 1] = v1x; vertPosY[vi + 1] = v1y; vertPosZ[vi + 1] = v1z;
    vertPosX[vi + 2] = v2x; vertPosY[vi + 2] = v2y; vertPosZ[vi + 2] = v2z;
    vertPosX[vi + 3] = v3x; vertPosY[vi + 3] = v3y; vertPosZ[vi + 3] = v3z;

    if (dir === 1) {
      indexBuf[ii]     = baseVert;
      indexBuf[ii + 1] = baseVert + 1;
      indexBuf[ii + 2] = baseVert + 2;
      indexBuf[ii + 3] = baseVert;
      indexBuf[ii + 4] = baseVert + 2;
      indexBuf[ii + 5] = baseVert + 3;
    } else {
      indexBuf[ii]     = baseVert;
      indexBuf[ii + 1] = baseVert + 2;
      indexBuf[ii + 2] = baseVert + 1;
      indexBuf[ii + 3] = baseVert;
      indexBuf[ii + 4] = baseVert + 3;
      indexBuf[ii + 5] = baseVert + 2;
    }

    quadCount++;
  }

  // --- X faces ---
  for (let dir = -1; dir <= 1; dir += 2) {
    const mask = new Int32Array(depth * height);
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < depth; y++) {
        for (let z = 0; z < height; z++) {
          if (isVisibleSolid(x, y, z) && isExteriorAir(x + dir, y, z)) {
            mask[y * height + z] = getBlock(x, y, z);
          } else {
            mask[y * height + z] = 0;
          }
        }
      }
      const used = new Uint8Array(depth * height);
      for (let y = 0; y < depth; y++) {
        for (let z = 0; z < height; z++) {
          const typ = mask[y * height + z];
          if (typ === 0 || used[y * height + z]) continue;
          let dz = 1;
          while (z + dz < height && mask[y * height + z + dz] === typ && !used[y * height + z + dz]) dz++;
          const maxDy = Math.min(depth - y, cellsUntilChunkBoundary(y));
          let dy = 1;
          outer: while (dy < maxDy) {
            for (let k = 0; k < dz; k++) {
              if (mask[(y + dy) * height + z + k] !== typ || used[(y + dy) * height + z + k]) break outer;
            }
            dy++;
          }
          for (let py = 0; py < dy; py++) for (let pz = 0; pz < dz; pz++) used[(y + py) * height + z + pz] = 1;
          const rgb = getBlockColor(blockColors, typ);
          const fx = dir === 1 ? x + 1 : x;
          addQuad(fx, y, z,  fx, y + dy, z,  fx, y + dy, z + dz,  fx, y, z + dz,  rgb.r, rgb.g, rgb.b, dir);
        }
      }
    }
  }

  // --- Y faces ---
  for (let dir = -1; dir <= 1; dir += 2) {
    const mask = new Int32Array(width * height);
    for (let y = 0; y < depth; y++) {
      for (let x = 0; x < width; x++) {
        for (let z = 0; z < height; z++) {
          if (isVisibleSolid(x, y, z) && isExteriorAir(x, y + dir, z)) {
            mask[x * height + z] = getBlock(x, y, z);
          } else {
            mask[x * height + z] = 0;
          }
        }
      }
      const used = new Uint8Array(width * height);
      for (let x = 0; x < width; x++) {
        for (let z = 0; z < height; z++) {
          const typ = mask[x * height + z];
          if (typ === 0 || used[x * height + z]) continue;
          let dz = 1;
          while (z + dz < height && mask[x * height + z + dz] === typ && !used[x * height + z + dz]) dz++;
          const maxDx = Math.min(width - x, cellsUntilChunkBoundary(x));
          let dx = 1;
          outer: while (dx < maxDx) {
            for (let k = 0; k < dz; k++) {
              if (mask[(x + dx) * height + z + k] !== typ || used[(x + dx) * height + z + k]) break outer;
            }
            dx++;
          }
          for (let px = 0; px < dx; px++) for (let pz = 0; pz < dz; pz++) used[(x + px) * height + z + pz] = 1;
          const rgb = getBlockColor(blockColors, typ);
          const fy = dir === 1 ? y + 1 : y;
          // Pre-invert winding to cancel the client-side unconditional b↔c swap for Y-faces
          addQuad(x, fy, z,  x + dx, fy, z,  x + dx, fy, z + dz,  x, fy, z + dz,  rgb.r, rgb.g, rgb.b, -dir);
        }
      }
    }
  }

  // --- Z faces (skip dir=-1: bottom/downward faces never visible from above) ---
  for (let dir = 1; dir <= 1; dir += 2) {
    const mask = new Int32Array(width * depth);
    for (let z = 0; z < height; z++) {
      for (let x = 0; x < width; x++) {
        for (let y = 0; y < depth; y++) {
          if (isVisibleSolid(x, y, z) && isExteriorAir(x, y, z + dir)) {
            mask[x * depth + y] = getBlock(x, y, z);
          } else {
            mask[x * depth + y] = 0;
          }
        }
      }
      const used = new Uint8Array(width * depth);
      for (let x = 0; x < width; x++) {
        for (let y = 0; y < depth; y++) {
          const typ = mask[x * depth + y];
          if (typ === 0 || used[x * depth + y]) continue;
          const maxDy = Math.min(depth - y, cellsUntilChunkBoundary(y));
          let dy = 1;
          while (dy < maxDy && mask[x * depth + y + dy] === typ && !used[x * depth + y + dy]) dy++;
          const maxDx = Math.min(width - x, cellsUntilChunkBoundary(x));
          let dx = 1;
          outer: while (dx < maxDx) {
            for (let k = 0; k < dy; k++) {
              if (mask[(x + dx) * depth + y + k] !== typ || used[(x + dx) * depth + y + k]) break outer;
            }
            dx++;
          }
          for (let px = 0; px < dx; px++) for (let py = 0; py < dy; py++) used[(x + px) * depth + y + py] = 1;
          const rgb = getBlockColor(blockColors, typ);
          const fz = z + 1; // dir is always +1 here
          addQuad(x, y, fz,  x + dx, y, fz,  x + dx, y + dy, fz,  x, y + dy, fz,  rgb.r, rgb.g, rgb.b, 1);
        }
      }
    }
  }

  const vertexCount = quadCount * 4;
  const indexCount = quadCount * 6;

  // Chunk-column coverage bitmask: bit (cx*4+cy) is set when the 32×32 column
  // at local offsets (cx*32 .. cx*32+31, cy*32 .. cy*32+31) has ≥1 non-air block.
  let chunkCoverage = 0;
  for (let cx = 0; cx < 4; cx++) {
    for (let cy = 0; cy < 4; cy++) {
      const x0 = cx * CHUNK_COLUMN_SIZE;
      const y0 = cy * CHUNK_COLUMN_SIZE;
      outer: for (let lx = x0; lx < x0 + CHUNK_COLUMN_SIZE; lx++) {
        for (let ly = y0; ly < y0 + CHUNK_COLUMN_SIZE; ly++) {
          for (let lz = 0; lz < height; lz++) {
            if (shouldIncludeBlock(lx, ly, lz)) {
              chunkCoverage |= 1 << (cx * 4 + cy);
              break outer;
            }
          }
        }
      }
    }
  }

  // Color section: 3 bytes per quad, padded to 4-byte alignment
  const colorBytes = quadCount * 3;
  const colorPadded = (colorBytes + 3) & ~3;

  // Position section: 4 bytes per vertex (u8 x, u8 y, u16 z)
  const posBytes = vertexCount * 4;

  // Index section: 4 bytes per index
  const idxBytes = indexCount * 4;

  // Trailer: 4 bytes (u32 chunkCoverage)
  const totalBytes = 24 + colorPadded + posBytes + idxBytes + 4;
  const buf = new ArrayBuffer(totalBytes);
  const view = new DataView(buf);

  // Header
  view.setInt32(0, worldX, true);
  view.setInt32(4, worldY, true);
  view.setInt32(8, worldZ, true);
  view.setUint32(12, quadCount, true);
  view.setUint32(16, indexCount, true);
  view.setUint32(20, voxelSize, true);

  // Per-quad colors
  let off = 24;
  for (let qi = 0; qi < quadCount; qi++) {
    view.setUint8(off++, quadColors[qi * 3]);
    view.setUint8(off++, quadColors[qi * 3 + 1]);
    view.setUint8(off++, quadColors[qi * 3 + 2]);
  }
  off = 24 + colorPadded; // skip padding

  // Per-vertex positions (4 per quad)
  for (let vi = 0; vi < vertexCount; vi++) {
    view.setUint8(off++, vertPosX[vi]);
    view.setUint8(off++, vertPosY[vi]);
    view.setUint16(off, vertPosZ[vi], true);
    off += 2;
  }

  // Indices
  for (let ii = 0; ii < indexCount; ii++) {
    view.setUint32(off, indexBuf[ii], true);
    off += 4;
  }

  // Trailer: chunk-column coverage bitmask
  view.setUint32(off, chunkCoverage, true);

  return buf;
}

export function encodeBinaryQuads(
  quads: BinaryQuad[],
  worldX: number,
  worldY: number,
  worldZ: number,
  voxelSize: number,
  blockColors: BlockColorTable,
  chunkCoverage: number,
): ArrayBuffer {
  let capacity = Math.max(4096, quads.length || 1);
  let quadCount = 0;
  let quadColors = new Uint8Array(capacity * 3);
  let vertPosX = new Uint8Array(capacity * 4);
  let vertPosY = new Uint8Array(capacity * 4);
  let vertPosZ = new Uint16Array(capacity * 4);
  let indexBuf = new Uint32Array(capacity * 6);

  function ensureCapacity() {
    if (quadCount < capacity) return;
    capacity *= 2;
    const qc2 = new Uint8Array(capacity * 3);
    qc2.set(quadColors);
    quadColors = qc2;
    const vx2 = new Uint8Array(capacity * 4);
    vx2.set(vertPosX);
    vertPosX = vx2;
    const vy2 = new Uint8Array(capacity * 4);
    vy2.set(vertPosY);
    vertPosY = vy2;
    const vz2 = new Uint16Array(capacity * 4);
    vz2.set(vertPosZ);
    vertPosZ = vz2;
    const ib2 = new Uint32Array(capacity * 6);
    ib2.set(indexBuf);
    indexBuf = ib2;
  }

  for (const quad of quads) {
    ensureCapacity();
    const qi = quadCount;
    const vi = qi * 4;
    const ii = qi * 6;
    const rgb = getBlockColor(blockColors, quad.typ);
    quadColors[qi * 3] = rgb.r;
    quadColors[qi * 3 + 1] = rgb.g;
    quadColors[qi * 3 + 2] = rgb.b;

    vertPosX[vi] = quad.v0x; vertPosY[vi] = quad.v0y; vertPosZ[vi] = quad.v0z;
    vertPosX[vi + 1] = quad.v1x; vertPosY[vi + 1] = quad.v1y; vertPosZ[vi + 1] = quad.v1z;
    vertPosX[vi + 2] = quad.v2x; vertPosY[vi + 2] = quad.v2y; vertPosZ[vi + 2] = quad.v2z;
    vertPosX[vi + 3] = quad.v3x; vertPosY[vi + 3] = quad.v3y; vertPosZ[vi + 3] = quad.v3z;

    if (quad.dir === 1) {
      indexBuf[ii] = vi;
      indexBuf[ii + 1] = vi + 1;
      indexBuf[ii + 2] = vi + 2;
      indexBuf[ii + 3] = vi;
      indexBuf[ii + 4] = vi + 2;
      indexBuf[ii + 5] = vi + 3;
    } else {
      indexBuf[ii] = vi;
      indexBuf[ii + 1] = vi + 2;
      indexBuf[ii + 2] = vi + 1;
      indexBuf[ii + 3] = vi;
      indexBuf[ii + 4] = vi + 3;
      indexBuf[ii + 5] = vi + 2;
    }

    quadCount++;
  }

  const vertexCount = quadCount * 4;
  const indexCount = quadCount * 6;
  const colorBytes = quadCount * 3;
  const colorPadded = (colorBytes + 3) & ~3;
  const posBytes = vertexCount * 4;
  const idxBytes = indexCount * 4;
  const totalBytes = 24 + colorPadded + posBytes + idxBytes + 4;
  const buf = new ArrayBuffer(totalBytes);
  const view = new DataView(buf);

  view.setInt32(0, worldX, true);
  view.setInt32(4, worldY, true);
  view.setInt32(8, worldZ, true);
  view.setUint32(12, quadCount, true);
  view.setUint32(16, indexCount, true);
  view.setUint32(20, voxelSize, true);

  let off = 24;
  for (let qi = 0; qi < quadCount; qi++) {
    view.setUint8(off++, quadColors[qi * 3]);
    view.setUint8(off++, quadColors[qi * 3 + 1]);
    view.setUint8(off++, quadColors[qi * 3 + 2]);
  }
  off = 24 + colorPadded;

  for (let vi = 0; vi < vertexCount; vi++) {
    view.setUint8(off++, vertPosX[vi]);
    view.setUint8(off++, vertPosY[vi]);
    view.setUint16(off, vertPosZ[vi], true);
    off += 2;
  }

  for (let ii = 0; ii < indexCount; ii++) {
    view.setUint32(off, indexBuf[ii], true);
    off += 4;
  }

  view.setUint32(off, chunkCoverage, true);
  return buf;
}

function getBlockColor(blockColors: BlockColorTable, paletteIndex: number): { r: number; g: number; b: number } {
  const off = paletteIndex * 3;
  if (off + 2 >= blockColors.rgb.length) {
    return { r: 128, g: 128, b: 128 };
  }
  return {
    r: blockColors.rgb[off],
    g: blockColors.rgb[off + 1],
    b: blockColors.rgb[off + 2],
  };
}
