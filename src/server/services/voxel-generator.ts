import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  CHUNK_SIZE,
  type ChunkData,
  parseRegionFile,
  REGION_SIZE,
  type RegionData,
} from "../parsers/region.js";
import {
  MAP_SIZE,
  parseSurfaceFile,
  type SurfaceData,
} from "../parsers/surface.js";
import type { VoxelGenerationStats } from "../workers/voxel-worker-protocol.js";
import type { BlockColorTable } from "./block-color-table.js";
import {
  type BinaryQuad,
  encodeBinaryQuads,
  VOXEL_REGION_SIZE,
} from "./greedy-mesh.js";
import { logger } from "./logger.js";
import { VOXEL_GENERATOR_CACHE_VERSION } from "./voxel-cache-version.js";

const VALID_LODS = [1, 2, 4, 8, 16, 32];
const COLUMN_VOXELS = VOXEL_REGION_SIZE;
const CHUNK_COLUMNS_PER_AXIS = COLUMN_VOXELS / CHUNK_SIZE;
const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE;
const MAX_ENTRANCE_DEPTH_WORLD = 64;
const PROJECT_VOXEL_CACHE_DIR = resolve(
  process.env.VOXEL_CACHE_DIR ??
    join(process.cwd(), "dist", "server", "cache", "voxels"),
);

type Direction = "x-" | "x+" | "y-" | "y+" | "z+" | "z-";

interface SurfaceHeightsData {
  heights: Int32Array;
  minHeight: number;
  hasSurface: boolean;
}

interface ColumnSignature {
  signature: string;
  zValues: number[];
}

interface SurfaceSignature {
  signature: string;
  data: SurfaceHeightsData;
}

interface ChunkState {
  chunkX: number;
  chunkY: number;
  chunkZ: number;
  pendingSeeds: number[];
  visitedAir: Uint8Array;
  scheduled: boolean;
}

interface SparsePlaneGroup {
  plane: number;
  rows: Map<number, Map<number, FaceEntry>>;
}

interface FaceEntry {
  typ: number;
  packedAo: number;
}

const OPPOSITE_FACE: Record<Direction, Direction> = {
  "x-": "x+",
  "x+": "x-",
  "y-": "y+",
  "y+": "y-",
  "z+": "z-",
  "z-": "z+",
};

const FACE_STEPS: { face: Direction; dx: number; dy: number; dz: number }[] = [
  { face: "x-", dx: -1, dy: 0, dz: 0 },
  { face: "x+", dx: 1, dy: 0, dz: 0 },
  { face: "y-", dx: 0, dy: -1, dz: 0 },
  { face: "y+", dx: 0, dy: 1, dz: 0 },
  { face: "z-", dx: 0, dy: 0, dz: -1 },
  { face: "z+", dx: 0, dy: 0, dz: 1 },
];

export async function generateVoxelMesh(
  savePath: string,
  blockColors: BlockColorTable,
  lod: number,
  regionX: number,
  regionY: number,
): Promise<{ buffer: ArrayBuffer | null; stats?: VoxelGenerationStats }> {
  const columnWorldSpan = COLUMN_VOXELS * lod;
  if (
    !VALID_LODS.includes(lod) ||
    regionX % columnWorldSpan !== 0 ||
    regionY % columnWorldSpan !== 0
  ) {
    throw new Error("Invalid lod/region coordinates");
  }

  const colDir = join(
    savePath,
    "chunks",
    String(lod),
    String(regionX),
    String(regionY),
  );
  if (!existsSync(colDir)) return { buffer: null };

  const columnSignature = await buildColumnSignature(colDir);
  if (columnSignature.zValues.length === 0) return { buffer: null };

  const surfaceSignature = await computeSurfaceHeightsWithSignature(
    savePath,
    regionX,
    regionY,
    lod,
  );
  if (!surfaceSignature.data.hasSurface) return { buffer: null };

  const saveCacheNamespace = createHash("sha1")
    .update(savePath)
    .digest("hex")
    .slice(0, 16);
  const persistentCacheDir = join(
    PROJECT_VOXEL_CACHE_DIR,
    saveCacheNamespace,
    String(lod),
    String(regionX),
  );
  const persistentCachePath = join(persistentCacheDir, `${regionY}.bin`);
  const cacheKey = createHash("sha1")
    .update(
      `${VOXEL_GENERATOR_CACHE_VERSION}|${MAX_ENTRANCE_DEPTH_WORLD}|${columnSignature.signature}|${surfaceSignature.signature}|${lod}|${regionX}|${regionY}`,
    )
    .digest("hex");
  const cached = await readPersistentMesh(persistentCachePath, cacheKey);
  if (cached) {
    const view = new DataView(cached);
    return {
      buffer: cached,
      stats: {
        cacheTier: "disk",
        quadCount: view.getUint32(12, true),
        chunkColumns: countChunkColumns(view, cached.byteLength),
        regionsParsed: 0,
        chunksMeshed: 0,
        visitedAirCells: 0,
        facesBeforeMerge: 0,
        minWorldZ: view.getInt32(8, true),
        maxWorldZ: extractMaxWorldZ(view, cached.byteLength),
      },
    };
  }

  const minChunkZ = Math.floor(
    Math.min(...columnSignature.zValues) / lod / CHUNK_SIZE,
  );
  const maxChunkZ =
    Math.floor(Math.max(...columnSignature.zValues) / lod / CHUNK_SIZE) +
    REGION_SIZE -
    1;

  const chunkStates = new Map<string, ChunkState>();
  const chunkQueue: ChunkState[] = [];
  const regionLoaders = new Map<number, Promise<RegionData | null>>();
  const occupancyCache = new Map<string, Promise<boolean>>();
  const faces = new Map<string, FaceEntry>();
  const visibleChunkColumns = new Set<number>();
  let regionsParsed = 0;
  let chunksMeshed = 0;
  let visitedAirCells = 0;

  function isAir(chunk: ChunkData | null, idx: number): boolean {
    if (!chunk) return true;
    return isAirType(chunk.blocks[idx] & 0xffff);
  }

  function getType(chunk: ChunkData | null, idx: number): number {
    if (!chunk) return 0;
    const typ = chunk.blocks[idx] & 0xffff;
    return isAirType(typ) ? 0 : typ;
  }

  function isAirType(paletteIndex: number): boolean {
    return paletteIndex === 0 || blockColors.airLike[paletteIndex] === 1;
  }

  await seedTopBoundary();
  await seedRegionBoundaries();

  while (chunkQueue.length > 0) {
    const state = chunkQueue.shift();
    if (!state) continue;
    state.scheduled = false;
    await processChunk(state);
  }

  await emitOuterRegionBoundaryFaces();

  if (faces.size === 0) return { buffer: null };

  const quads = buildMergedQuads(faces);
  let minFaceZ = Number.POSITIVE_INFINITY;
  for (const [key, typ] of faces) {
    const [xStr, yStr, _zStr, face] = key.split("/") as [
      string,
      string,
      string,
      Direction,
    ];
    const x = parseInt(xStr, 10);
    const y = parseInt(yStr, 10);
    visibleChunkColumns.add(
      Math.floor(x / CHUNK_SIZE) * 4 + Math.floor(y / CHUNK_SIZE),
    );
    void typ;
    void face;
  }
  for (const quad of quads) {
    minFaceZ = Math.min(minFaceZ, quad.v0z, quad.v1z, quad.v2z, quad.v3z);
  }

  if (!Number.isFinite(minFaceZ)) return { buffer: null };
  const baseWorldZ = minFaceZ * lod;
  const baseCellZ = Math.floor(baseWorldZ / lod);
  for (const quad of quads) {
    quad.v0z -= baseCellZ;
    quad.v1z -= baseCellZ;
    quad.v2z -= baseCellZ;
    quad.v3z -= baseCellZ;
  }

  let chunkCoverage = 0;
  for (const idx of visibleChunkColumns) {
    chunkCoverage |= 1 << idx;
  }

  const mesh = encodeBinaryQuads(
    quads,
    regionX,
    regionY,
    baseWorldZ,
    lod,
    blockColors,
    chunkCoverage,
  );
  const view = new DataView(mesh);
  if (view.getUint32(12, true) === 0) return { buffer: null };

  await mkdir(persistentCacheDir, { recursive: true });
  await writePersistentMesh(persistentCachePath, cacheKey, mesh);
  return {
    buffer: mesh,
    stats: {
      cacheTier: "worker",
      quadCount: quads.length,
      chunkColumns: visibleChunkColumns.size,
      regionsParsed,
      chunksMeshed,
      visitedAirCells,
      facesBeforeMerge: faces.size,
      minWorldZ: baseWorldZ,
      maxWorldZ: extractMaxWorldZ(view, mesh.byteLength),
    },
  };

  async function seedTopBoundary(): Promise<void> {
    for (let chunkX = 0; chunkX < CHUNK_COLUMNS_PER_AXIS; chunkX++) {
      for (let chunkY = 0; chunkY < CHUNK_COLUMNS_PER_AXIS; chunkY++) {
        const topChunk = await loadChunk(chunkX, chunkY, maxChunkZ);
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          for (let ly = 0; ly < CHUNK_SIZE; ly++) {
            if (!topChunk) continue;

            // Surface tiles can sit below tall structures like peaks or spires.
            // Start from the highest actual air cell in the top loaded chunk so
            // exterior traversal still reaches those columns from open sky.
            for (let lz = CHUNK_SIZE - 1; lz >= 0; lz--) {
              const idx = localIndex(lx, ly, lz);
              if (!isAir(topChunk, idx)) continue;
              seedChunkAir(chunkX, chunkY, maxChunkZ, lx, ly, lz);
              break;
            }
          }
        }
      }
    }
  }

  async function seedRegionBoundaries(): Promise<void> {
    for (let gy = 0; gy < COLUMN_VOXELS; gy++) {
      await seedBoundaryColumn(0, gy);
      await seedBoundaryColumn(COLUMN_VOXELS - 1, gy);
    }
    for (let gx = 0; gx < COLUMN_VOXELS; gx++) {
      await seedBoundaryColumn(gx, 0);
      await seedBoundaryColumn(gx, COLUMN_VOXELS - 1);
    }
  }

  async function seedBoundaryColumn(
    gx: number,
    gy: number,
    dx = 0,
    dy = 0,
  ): Promise<void> {
    const startCell =
      Math.floor(surfaceSignature.data.heights[gx * COLUMN_VOXELS + gy] / lod) +
      1;
    if (
      startCell < minChunkZ * CHUNK_SIZE ||
      startCell > (maxChunkZ + 1) * CHUNK_SIZE - 1
    )
      return;
    await seedWorldAir(gx, gy, startCell);
    if (dx !== 0 || dy !== 0) {
      await seedWorldAir(gx + dx, gy + dy, startCell);
    }
  }

  async function seedWorldAir(
    gx: number,
    gy: number,
    startCell: number,
  ): Promise<void> {
    if (gx < 0 || gx >= COLUMN_VOXELS || gy < 0 || gy >= COLUMN_VOXELS) return;
    for (let gz = startCell; gz <= (maxChunkZ + 1) * CHUNK_SIZE - 1; gz++) {
      const chunkX = Math.floor(gx / CHUNK_SIZE);
      const chunkY = Math.floor(gy / CHUNK_SIZE);
      const chunkZ = Math.floor(gz / CHUNK_SIZE);
      const chunk = await loadChunk(chunkX, chunkY, chunkZ);
      if (!chunk) continue;
      const lx = gx % CHUNK_SIZE;
      const ly = gy % CHUNK_SIZE;
      const lz = gz % CHUNK_SIZE;
      const idx = localIndex(lx, ly, lz);
      if (!isAir(chunk, idx)) continue;
      seedChunkAir(chunkX, chunkY, chunkZ, lx, ly, lz);
      return;
    }
  }

  function seedChunkAir(
    chunkX: number,
    chunkY: number,
    chunkZ: number,
    lx: number,
    ly: number,
    lz: number,
  ): void {
    if (
      chunkX < 0 ||
      chunkX >= CHUNK_COLUMNS_PER_AXIS ||
      chunkY < 0 ||
      chunkY >= CHUNK_COLUMNS_PER_AXIS
    )
      return;
    if (chunkZ < minChunkZ || chunkZ > maxChunkZ) return;
    if (
      lx < 0 ||
      lx >= CHUNK_SIZE ||
      ly < 0 ||
      ly >= CHUNK_SIZE ||
      lz < 0 ||
      lz >= CHUNK_SIZE
    )
      return;
    const gx = chunkX * CHUNK_SIZE + lx;
    const gy = chunkY * CHUNK_SIZE + ly;
    const gz = chunkZ * CHUNK_SIZE + lz;
    if (!isWithinEntranceDepth(gx, gy, gz, surfaceSignature.data.heights, lod))
      return;
    const state = getChunkState(chunkX, chunkY, chunkZ);
    const idx = localIndex(lx, ly, lz);
    if (state.visitedAir[idx] !== 0) return;
    state.pendingSeeds.push(idx);
    if (!state.scheduled) {
      state.scheduled = true;
      chunkQueue.push(state);
    }
  }

  async function processChunk(state: ChunkState): Promise<void> {
    const chunk = await loadChunk(state.chunkX, state.chunkY, state.chunkZ);
    if (!chunk) return;
    const queue: number[] = [];

    while (state.pendingSeeds.length > 0) {
      const seed = state.pendingSeeds.pop();
      if (seed === undefined) continue;
      if (state.visitedAir[seed] !== 0) continue;
      if (!isAir(chunk, seed)) continue;
      state.visitedAir[seed] = 1;
      visitedAirCells++;
      queue.push(seed);
    }

    while (queue.length > 0) {
      const idx = queue.pop();
      if (idx === undefined) continue;
      const lx = Math.floor(idx / (CHUNK_SIZE * CHUNK_SIZE));
      const ly = Math.floor((idx % (CHUNK_SIZE * CHUNK_SIZE)) / CHUNK_SIZE);
      const lz = idx % CHUNK_SIZE;
      const gx = state.chunkX * CHUNK_SIZE + lx;
      const gy = state.chunkY * CHUNK_SIZE + ly;
      const gz = state.chunkZ * CHUNK_SIZE + lz;

      for (const step of FACE_STEPS) {
        const nlx = lx + step.dx;
        const nly = ly + step.dy;
        const nlz = lz + step.dz;

        if (
          nlx >= 0 &&
          nlx < CHUNK_SIZE &&
          nly >= 0 &&
          nly < CHUNK_SIZE &&
          nlz >= 0 &&
          nlz < CHUNK_SIZE
        ) {
          const neighborIdx = localIndex(nlx, nly, nlz);
          if (isAir(chunk, neighborIdx)) {
            if (state.visitedAir[neighborIdx] === 0) {
              const ngx = state.chunkX * CHUNK_SIZE + nlx;
              const ngy = state.chunkY * CHUNK_SIZE + nly;
              const ngz = state.chunkZ * CHUNK_SIZE + nlz;
              if (
                isWithinEntranceDepth(
                  ngx,
                  ngy,
                  ngz,
                  surfaceSignature.data.heights,
                  lod,
                )
              ) {
                state.visitedAir[neighborIdx] = 1;
                visitedAirCells++;
                queue.push(neighborIdx);
              }
            }
          } else {
            const face = OPPOSITE_FACE[step.face];
            const solidX = gx + step.dx;
            const solidY = gy + step.dy;
            const solidZ = gz + step.dz;
            if (
              shouldEmitFace(
                face,
                solidX,
                solidY,
                solidZ,
                surfaceSignature.data.heights,
                lod,
              )
            ) {
              addFace(faces, solidX, solidY, solidZ, face, {
                typ: getType(chunk, neighborIdx),
                packedAo: await getPackedFaceAo(face, solidX, solidY, solidZ),
              });
            }
          }
          continue;
        }

        const neighborChunkX =
          state.chunkX + (nlx < 0 ? -1 : nlx >= CHUNK_SIZE ? 1 : 0);
        const neighborChunkY =
          state.chunkY + (nly < 0 ? -1 : nly >= CHUNK_SIZE ? 1 : 0);
        const neighborChunkZ =
          state.chunkZ + (nlz < 0 ? -1 : nlz >= CHUNK_SIZE ? 1 : 0);
        const wrappedLx = (nlx + CHUNK_SIZE) % CHUNK_SIZE;
        const wrappedLy = (nly + CHUNK_SIZE) % CHUNK_SIZE;
        const wrappedLz = (nlz + CHUNK_SIZE) % CHUNK_SIZE;

        if (
          neighborChunkX < 0 ||
          neighborChunkX >= CHUNK_COLUMNS_PER_AXIS ||
          neighborChunkY < 0 ||
          neighborChunkY >= CHUNK_COLUMNS_PER_AXIS
        ) {
          continue;
        }
        if (neighborChunkZ < minChunkZ || neighborChunkZ > maxChunkZ) {
          continue;
        }
        const neighborChunk = await loadChunk(
          neighborChunkX,
          neighborChunkY,
          neighborChunkZ,
        );
        if (!neighborChunk) {
          continue;
        }
        const wrappedIdx = localIndex(wrappedLx, wrappedLy, wrappedLz);
        if (isAir(neighborChunk, wrappedIdx)) {
          seedChunkAir(
            neighborChunkX,
            neighborChunkY,
            neighborChunkZ,
            wrappedLx,
            wrappedLy,
            wrappedLz,
          );
          continue;
        }
        const face = OPPOSITE_FACE[step.face];
        const solidX = gx + step.dx;
        const solidY = gy + step.dy;
        const solidZ = gz + step.dz;
        if (
          shouldEmitFace(
            face,
            solidX,
            solidY,
            solidZ,
            surfaceSignature.data.heights,
            lod,
          )
        ) {
          addFace(faces, solidX, solidY, solidZ, face, {
            typ: getType(neighborChunk, wrappedIdx),
            packedAo: await getPackedFaceAo(face, solidX, solidY, solidZ),
          });
        }
      }
    }
  }

  function getChunkState(
    chunkX: number,
    chunkY: number,
    chunkZ: number,
  ): ChunkState {
    const key = `${chunkX}/${chunkY}/${chunkZ}`;
    let state = chunkStates.get(key);
    if (!state) {
      state = {
        chunkX,
        chunkY,
        chunkZ,
        pendingSeeds: [],
        visitedAir: new Uint8Array(CHUNK_VOLUME),
        scheduled: false,
      };
      chunkStates.set(key, state);
    }
    return state;
  }

  async function loadChunk(
    chunkX: number,
    chunkY: number,
    chunkZ: number,
  ): Promise<ChunkData | null> {
    const regionChunkZ = Math.floor(chunkZ / REGION_SIZE) * REGION_SIZE;
    const regionWorldZ = regionChunkZ * CHUNK_SIZE * lod;
    let loader = regionLoaders.get(regionWorldZ);
    if (!loader) {
      loader = (async () => {
        const path = join(colDir, `${regionWorldZ}.region`);
        if (!existsSync(path)) return null;
        try {
          regionsParsed++;
          return await parseRegionFile(
            path,
            regionX,
            regionY,
            regionWorldZ,
            lod,
          );
        } catch (error) {
          logger.warn("Failed to parse sparse region", {
            path,
            lod,
            regionX,
            regionY,
            regionWorldZ,
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        }
      })();
      regionLoaders.set(regionWorldZ, loader);
    }
    const region = await loader;
    if (!region) return null;
    const localChunkZ = chunkZ - regionChunkZ;
    const chunkIndex =
      chunkX * REGION_SIZE * REGION_SIZE + chunkY * REGION_SIZE + localChunkZ;
    const chunk = region.chunks[chunkIndex] ?? null;
    if (chunk) {
      chunksMeshed++;
    }
    return chunk;
  }

  async function emitOuterRegionBoundaryFaces(): Promise<void> {
    for (let chunkZ = minChunkZ; chunkZ <= maxChunkZ; chunkZ++) {
      for (let chunkY = 0; chunkY < CHUNK_COLUMNS_PER_AXIS; chunkY++) {
        const leftChunk = await loadChunk(0, chunkY, chunkZ);
        if (leftChunk) {
          await emitChunkEdgeFaces(leftChunk, 0, chunkY, chunkZ, 0, "x-");
        }
        const rightChunk = await loadChunk(
          CHUNK_COLUMNS_PER_AXIS - 1,
          chunkY,
          chunkZ,
        );
        if (rightChunk) {
          await emitChunkEdgeFaces(
            rightChunk,
            CHUNK_COLUMNS_PER_AXIS - 1,
            chunkY,
            chunkZ,
            CHUNK_SIZE - 1,
            "x+",
          );
        }
      }
      for (let chunkX = 0; chunkX < CHUNK_COLUMNS_PER_AXIS; chunkX++) {
        const frontChunk = await loadChunk(chunkX, 0, chunkZ);
        if (frontChunk) {
          await emitChunkEdgeFaces(frontChunk, chunkX, 0, chunkZ, 0, "y-");
        }
        const backChunk = await loadChunk(
          chunkX,
          CHUNK_COLUMNS_PER_AXIS - 1,
          chunkZ,
        );
        if (backChunk) {
          await emitChunkEdgeFaces(
            backChunk,
            chunkX,
            CHUNK_COLUMNS_PER_AXIS - 1,
            chunkZ,
            CHUNK_SIZE - 1,
            "y+",
          );
        }
      }
    }
  }

  async function emitChunkEdgeFaces(
    chunk: ChunkData,
    chunkX: number,
    chunkY: number,
    chunkZ: number,
    edgeCoord: number,
    face: Direction,
  ): Promise<void> {
    const isXFace = face === "x-" || face === "x+";
    const edgeChunkX = chunkX + (face === "x-" ? -1 : face === "x+" ? 1 : 0);
    const edgeChunkY = chunkY + (face === "y-" ? -1 : face === "y+" ? 1 : 0);
    const neighborChunk = await loadExternalChunk(
      edgeChunkX,
      edgeChunkY,
      chunkZ,
    );

    for (let u = 0; u < CHUNK_SIZE; u++) {
      for (let v = 0; v < CHUNK_SIZE; v++) {
        const lx = isXFace ? edgeCoord : u;
        const ly = isXFace ? u : edgeCoord;
        const lz = v;
        const idx = localIndex(lx, ly, lz);
        const typ = getType(chunk, idx);
        if (typ === 0) continue;

        const gx = chunkX * CHUNK_SIZE + lx;
        const gy = chunkY * CHUNK_SIZE + ly;
        const gz = chunkZ * CHUNK_SIZE + lz;
        const airX = gx + (face === "x-" ? -1 : face === "x+" ? 1 : 0);
        const airY = gy + (face === "y-" ? -1 : face === "y+" ? 1 : 0);
        if (
          !isBoundaryVisibleFromAir(
            face,
            gx,
            gy,
            gz,
            airX,
            airY,
            surfaceSignature.data.heights,
            lod,
          )
        )
          continue;

        const neighborLocalX =
          face === "x-" ? CHUNK_SIZE - 1 : face === "x+" ? 0 : lx;
        const neighborLocalY =
          face === "y-" ? CHUNK_SIZE - 1 : face === "y+" ? 0 : ly;
        const neighborIdx = localIndex(neighborLocalX, neighborLocalY, lz);
        if (!isAir(neighborChunk, neighborIdx)) continue;

        addFace(faces, gx, gy, gz, face, {
          typ,
          packedAo: await getPackedFaceAo(face, gx, gy, gz),
        });
      }
    }
  }

  async function loadExternalChunk(
    chunkX: number,
    chunkY: number,
    chunkZ: number,
  ): Promise<ChunkData | null> {
    const externalRegionX = regionX + chunkX * CHUNK_SIZE * lod;
    const externalRegionY = regionY + chunkY * CHUNK_SIZE * lod;
    const columnWorldSpan = COLUMN_VOXELS * lod;
    const normalizedRegionX =
      Math.floor(externalRegionX / columnWorldSpan) * columnWorldSpan;
    const normalizedRegionY =
      Math.floor(externalRegionY / columnWorldSpan) * columnWorldSpan;
    const localChunkX = Math.floor(
      (externalRegionX - normalizedRegionX) / (CHUNK_SIZE * lod),
    );
    const localChunkY = Math.floor(
      (externalRegionY - normalizedRegionY) / (CHUNK_SIZE * lod),
    );
    const regionChunkZ = Math.floor(chunkZ / REGION_SIZE) * REGION_SIZE;
    const regionWorldZ = regionChunkZ * CHUNK_SIZE * lod;
    const path = join(
      savePath,
      "chunks",
      String(lod),
      String(normalizedRegionX),
      String(normalizedRegionY),
      `${regionWorldZ}.region`,
    );
    if (!existsSync(path)) return null;
    try {
      const region = await parseRegionFile(
        path,
        normalizedRegionX,
        normalizedRegionY,
        regionWorldZ,
        lod,
      );
      const localChunkZ = chunkZ - regionChunkZ;
      const chunkIndex =
        localChunkX * REGION_SIZE * REGION_SIZE +
        localChunkY * REGION_SIZE +
        localChunkZ;
      return region.chunks[chunkIndex] ?? null;
    } catch (error) {
      logger.warn("Failed to parse external sparse region", {
        path,
        lod,
        normalizedRegionX,
        normalizedRegionY,
        regionWorldZ,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  async function getPackedFaceAo(
    face: Direction,
    x: number,
    y: number,
    z: number,
  ): Promise<number> {
    if ((lod !== 1 && lod !== 2) || face !== "z+") return 0;
    return getPackedTopFaceAo(x, y, z);
  }

  async function getPackedTopFaceAo(
    x: number,
    y: number,
    z: number,
  ): Promise<number> {
    const corners: Array<[number, number, number, number]> = [
      [-1, 0, 0, -1],
      [1, 0, 0, -1],
      [1, 0, 0, 1],
      [-1, 0, 0, 1],
    ];

    let packed = 0;
    for (let i = 0; i < corners.length; i++) {
      const corner = corners[i];
      if (!corner) continue;
      const [sideAx, sideAy, sideBx, sideBy] = corner;
      const sideA = await isSolidCellWorld(x + sideAx, y + sideAy, z + 1);
      const sideB = await isSolidCellWorld(x + sideBx, y + sideBy, z + 1);
      const diagonal = await isSolidCellWorld(
        x + sideAx + sideBx,
        y + sideAy + sideBy,
        z + 1,
      );
      packed |= computeCornerAo(sideA, sideB, diagonal) << (i * 2);
    }

    return packed;
  }

  function computeCornerAo(
    sideA: boolean,
    sideB: boolean,
    diagonal: boolean,
  ): number {
    if (sideA && sideB) return 3;
    return Number(sideA) + Number(sideB) + Number(diagonal);
  }

  async function isSolidCellWorld(
    x: number,
    y: number,
    z: number,
  ): Promise<boolean> {
    const cacheKey = `${x}/${y}/${z}`;
    const cached = occupancyCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const pending = (async () => {
      if (z < minChunkZ * CHUNK_SIZE || z > (maxChunkZ + 1) * CHUNK_SIZE - 1) {
        return false;
      }

      const chunkX = Math.floor(x / CHUNK_SIZE);
      const chunkY = Math.floor(y / CHUNK_SIZE);
      const chunkZ = Math.floor(z / CHUNK_SIZE);
      const localX = ((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
      const localY = ((y % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
      const localZ = ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;

      const chunk =
        chunkX >= 0 &&
        chunkX < CHUNK_COLUMNS_PER_AXIS &&
        chunkY >= 0 &&
        chunkY < CHUNK_COLUMNS_PER_AXIS
          ? await loadChunk(chunkX, chunkY, chunkZ)
          : await loadExternalChunk(chunkX, chunkY, chunkZ);

      if (!chunk) return false;
      return !isAir(chunk, localIndex(localX, localY, localZ));
    })();

    occupancyCache.set(cacheKey, pending);
    return pending;
  }
}

async function buildColumnSignature(colDir: string): Promise<ColumnSignature> {
  const entries = await readdir(colDir);
  const zValues = entries
    .filter((entry) => entry.endsWith(".region"))
    .map((entry) => parseInt(entry.slice(0, -".region".length), 10))
    .filter((value) => !Number.isNaN(value))
    .sort((a, b) => b - a);
  const hash = createHash("sha1");
  for (const worldZ of zValues) {
    const path = join(colDir, `${worldZ}.region`);
    const stats = await stat(path);
    hash.update(`${worldZ}:${Math.trunc(stats.mtimeMs)}:${stats.size}|`);
  }
  return { signature: hash.digest("hex"), zValues };
}

async function computeSurfaceHeightsWithSignature(
  savePath: string,
  regionX: number,
  regionY: number,
  lod: number,
): Promise<SurfaceSignature> {
  const regionSpanWorld = COLUMN_VOXELS * lod;
  const heights = new Int32Array(COLUMN_VOXELS * COLUMN_VOXELS);
  const hash = createHash("sha1");

  const sameTileSize = MAP_SIZE * lod;
  const sameTileX = Math.floor(regionX / sameTileSize) * sameTileSize;
  const sameTileY = Math.floor(regionY / sameTileSize) * sameTileSize;
  const samePath = join(
    savePath,
    "maps",
    String(lod),
    String(sameTileX),
    `${sameTileY}.surface`,
  );
  if (existsSync(samePath)) {
    try {
      const stats = await stat(samePath);
      hash.update(`${samePath}:${Math.trunc(stats.mtimeMs)}:${stats.size}|`);
      const surface = await parseSurfaceFile(
        samePath,
        sameTileX,
        sameTileY,
        lod,
      );
      const localX0 = (regionX - sameTileX) / lod;
      const localY0 = (regionY - sameTileY) / lod;
      let minSurfaceH = Infinity;
      for (let lx = localX0; lx < localX0 + COLUMN_VOXELS; lx++) {
        for (let ly = localY0; ly < localY0 + COLUMN_VOXELS; ly++) {
          const h = surface.heights[lx * MAP_SIZE + ly];
          heights[(lx - localX0) * COLUMN_VOXELS + (ly - localY0)] = h;
          if (h < minSurfaceH) minSurfaceH = h;
        }
      }
      if (Number.isFinite(minSurfaceH)) {
        return {
          signature: hash.digest("hex"),
          data: { heights, minHeight: minSurfaceH, hasSurface: true },
        };
      }
    } catch (error) {
      logger.warn("Surface read failed for voxels", {
        lod,
        regionX,
        regionY,
        sourcePath: samePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const x0 = regionX;
  const y0 = regionY;
  const x1 = regionX + regionSpanWorld;
  const y1 = regionY + regionSpanWorld;
  const tileXStart = Math.floor(x0 / MAP_SIZE) * MAP_SIZE;
  const tileYStart = Math.floor(y0 / MAP_SIZE) * MAP_SIZE;
  const tileXEnd = Math.floor((x1 - 1) / MAP_SIZE) * MAP_SIZE;
  const tileYEnd = Math.floor((y1 - 1) / MAP_SIZE) * MAP_SIZE;

  const unresolved = 0x7fffffff;
  heights.fill(unresolved);
  let minSurfaceH = Infinity;
  let foundSurface = false;
  const surfaceCache = new Map<string, Promise<SurfaceData | null>>();

  function getSurfaceTile(
    tileX: number,
    tileY: number,
  ): Promise<SurfaceData | null> {
    const key = `${tileX}/${tileY}`;
    const cached = surfaceCache.get(key);
    if (cached) return cached;
    const path = join(savePath, "maps", "1", String(tileX), `${tileY}.surface`);
    const promise = existsSync(path)
      ? parseSurfaceFile(path, tileX, tileY, 1).catch((error) => {
          logger.warn("Surface read failed for fallback voxels", {
            lod,
            regionX,
            regionY,
            tileX,
            tileY,
            sourcePath: path,
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        })
      : Promise.resolve(null);
    surfaceCache.set(key, promise);
    return promise;
  }

  for (let tileX = tileXStart; tileX <= tileXEnd; tileX += MAP_SIZE) {
    for (let tileY = tileYStart; tileY <= tileYEnd; tileY += MAP_SIZE) {
      const path = join(
        savePath,
        "maps",
        "1",
        String(tileX),
        `${tileY}.surface`,
      );
      if (existsSync(path)) {
        const stats = await stat(path);
        hash.update(`${path}:${Math.trunc(stats.mtimeMs)}:${stats.size}|`);
      }
      const surface = await getSurfaceTile(tileX, tileY);
      if (!surface) continue;
      foundSurface = true;
      const overlapX0 = Math.max(x0, tileX);
      const overlapY0 = Math.max(y0, tileY);
      const overlapX1 = Math.min(x1, tileX + MAP_SIZE);
      const overlapY1 = Math.min(y1, tileY + MAP_SIZE);
      for (let wx = overlapX0; wx < overlapX1; wx++) {
        for (let wy = overlapY0; wy < overlapY1; wy++) {
          const localX = Math.floor((wx - regionX) / lod);
          const localY = Math.floor((wy - regionY) / lod);
          if (
            localX < 0 ||
            localX >= COLUMN_VOXELS ||
            localY < 0 ||
            localY >= COLUMN_VOXELS
          )
            continue;
          const h = surface.heights[(wx - tileX) * MAP_SIZE + (wy - tileY)];
          const idx = localX * COLUMN_VOXELS + localY;
          if (h < heights[idx]) heights[idx] = h;
          if (h < minSurfaceH) minSurfaceH = h;
        }
      }
    }
  }

  if (!foundSurface || !Number.isFinite(minSurfaceH)) {
    return {
      signature: hash.digest("hex"),
      data: {
        heights: new Int32Array(COLUMN_VOXELS * COLUMN_VOXELS),
        minHeight: 0,
        hasSurface: false,
      },
    };
  }

  for (let i = 0; i < heights.length; i++) {
    if (heights[i] === unresolved) heights[i] = minSurfaceH;
  }

  return {
    signature: hash.digest("hex"),
    data: { heights, minHeight: minSurfaceH, hasSurface: true },
  };
}

function localIndex(x: number, y: number, z: number): number {
  return x * CHUNK_SIZE * CHUNK_SIZE + y * CHUNK_SIZE + z;
}

function isVisibleSolid(
  x: number,
  y: number,
  z: number,
  surfaceHeights: Int32Array,
  lod: number,
): boolean {
  if (x < 0 || x >= COLUMN_VOXELS || y < 0 || y >= COLUMN_VOXELS) return false;
  const worldCellTopZ = (z + 1) * lod;
  return (
    worldCellTopZ >
    surfaceHeights[x * COLUMN_VOXELS + y] - MAX_ENTRANCE_DEPTH_WORLD
  );
}

function shouldEmitFace(
  face: Direction,
  x: number,
  y: number,
  z: number,
  surfaceHeights: Int32Array,
  lod: number,
): boolean {
  if (face === "z-") return false;
  if (face === "x+" || face === "x-" || face === "y+" || face === "y-") {
    return true;
  }
  return isVisibleSolid(x, y, z, surfaceHeights, lod);
}

function isBoundaryVisibleFromAir(
  face: Direction,
  solidX: number,
  solidY: number,
  solidZ: number,
  airX: number,
  airY: number,
  surfaceHeights: Int32Array,
  lod: number,
): boolean {
  if (face === "z-") return false;
  if (face === "z+") {
    return isVisibleSolid(solidX, solidY, solidZ, surfaceHeights, lod);
  }
  const surfaceX = airX >= 0 && airX < COLUMN_VOXELS ? airX : solidX;
  const surfaceY = airY >= 0 && airY < COLUMN_VOXELS ? airY : solidY;
  if (
    surfaceX < 0 ||
    surfaceX >= COLUMN_VOXELS ||
    surfaceY < 0 ||
    surfaceY >= COLUMN_VOXELS
  ) {
    return false;
  }
  const worldCellBottomZ = solidZ * lod;
  return (
    worldCellBottomZ >=
    surfaceHeights[surfaceX * COLUMN_VOXELS + surfaceY] -
      MAX_ENTRANCE_DEPTH_WORLD
  );
}

function isWithinEntranceDepth(
  x: number,
  y: number,
  z: number,
  surfaceHeights: Int32Array,
  lod: number,
): boolean {
  if (x < 0 || x >= COLUMN_VOXELS || y < 0 || y >= COLUMN_VOXELS) return false;
  const worldCellBottomZ = z * lod;
  return (
    worldCellBottomZ >=
    surfaceHeights[x * COLUMN_VOXELS + y] - MAX_ENTRANCE_DEPTH_WORLD
  );
}

function addFace(
  faceMap: Map<string, FaceEntry>,
  x: number,
  y: number,
  z: number,
  face: Direction,
  entry: FaceEntry,
): void {
  const key = `${x}/${y}/${z}/${face}`;
  if (!faceMap.has(key)) {
    faceMap.set(key, entry);
  }
}

function buildMergedQuads(faceMap: Map<string, FaceEntry>): BinaryQuad[] {
  const groups = new Map<string, SparsePlaneGroup>();
  for (const [key, entry] of faceMap) {
    const [xStr, yStr, zStr, face] = key.split("/") as [
      string,
      string,
      string,
      Direction,
    ];
    const x = parseInt(xStr, 10);
    const y = parseInt(yStr, 10);
    const z = parseInt(zStr, 10);
    const plane = getPlaneCoordinate(x, y, z, face);
    const planeKey = `${face}:${plane}`;
    let group = groups.get(planeKey);
    if (!group) {
      group = { plane, rows: new Map() };
      groups.set(planeKey, group);
    }
    const { u, v } = getPlaneAxes(x, y, z, face);
    let row = group.rows.get(u);
    if (!row) {
      row = new Map();
      group.rows.set(u, row);
    }
    row.set(v, entry);
  }

  const quads: BinaryQuad[] = [];
  for (const [planeKey, group] of groups) {
    const [face] = planeKey.split(":") as [Direction];
    const uValues = [...group.rows.keys()].sort((a, b) => a - b);
    for (const u of uValues) {
      const row = group.rows.get(u);
      if (!row || row.size === 0) continue;
      const vValues = [...row.keys()].sort((a, b) => a - b);
      const isTopFace = face === "z+";
      const isSideFace =
        face === "x+" || face === "x-" || face === "y+" || face === "y-";
      for (const v of vValues) {
        const entry = row.get(v);
        if (!entry) continue;
        if (isTopFace) {
          row.delete(v);
          quads.push(
            createMergedQuad(
              face,
              group.plane,
              u,
              v,
              1,
              1,
              entry.typ,
              entry.packedAo,
            ),
          );
          continue;
        }
        const maxV =
          face === "z-"
            ? Math.min(COLUMN_VOXELS, v + cellsUntilChunkBoundary(v))
            : Number.MAX_SAFE_INTEGER;
        let dv = 1;
        while (v + dv < maxV && row.get(v + dv)?.typ === entry.typ) {
          dv++;
        }

        const maxU = Math.min(COLUMN_VOXELS, u + cellsUntilChunkBoundary(u));
        let du = 1;
        if (!isSideFace) {
          outer: while (u + du < maxU) {
            const nextRow = group.rows.get(u + du);
            if (!nextRow) break;
            for (let vv = v; vv < v + dv; vv++) {
              if (nextRow.get(vv)?.typ !== entry.typ) break outer;
            }
            du++;
          }
        }

        for (let uu = u; uu < u + du; uu++) {
          const usedRow = group.rows.get(uu);
          if (!usedRow) continue;
          for (let vv = v; vv < v + dv; vv++) {
            usedRow.delete(vv);
          }
        }

        quads.push(
          createMergedQuad(face, group.plane, u, v, du, dv, entry.typ, 0),
        );
      }
    }
  }

  return quads;
}

function getPlaneCoordinate(
  x: number,
  y: number,
  z: number,
  face: Direction,
): number {
  switch (face) {
    case "x+":
      return x + 1;
    case "x-":
      return x;
    case "y+":
      return y + 1;
    case "y-":
      return y;
    case "z+":
      return z + 1;
    case "z-":
      return z;
  }
}

function getPlaneAxes(
  x: number,
  y: number,
  z: number,
  face: Direction,
): { u: number; v: number } {
  switch (face) {
    case "x+":
    case "x-":
      return { u: y, v: z };
    case "y+":
    case "y-":
      return { u: x, v: z };
    case "z+":
    case "z-":
      return { u: x, v: y };
  }
}

function createMergedQuad(
  face: Direction,
  plane: number,
  u: number,
  v: number,
  du: number,
  dv: number,
  typ: number,
  packedAo: number,
): BinaryQuad {
  switch (face) {
    case "x+":
      return {
        v0x: plane,
        v0y: u,
        v0z: v,
        v1x: plane,
        v1y: u + du,
        v1z: v,
        v2x: plane,
        v2y: u + du,
        v2z: v + dv,
        v3x: plane,
        v3y: u,
        v3z: v + dv,
        typ,
        dir: 1,
        packedAo,
      };
    case "x-":
      return {
        v0x: plane,
        v0y: u,
        v0z: v,
        v1x: plane,
        v1y: u + du,
        v1z: v,
        v2x: plane,
        v2y: u + du,
        v2z: v + dv,
        v3x: plane,
        v3y: u,
        v3z: v + dv,
        typ,
        dir: -1,
        packedAo,
      };
    case "y+":
      return {
        v0x: u,
        v0y: plane,
        v0z: v,
        v1x: u + du,
        v1y: plane,
        v1z: v,
        v2x: u + du,
        v2y: plane,
        v2z: v + dv,
        v3x: u,
        v3y: plane,
        v3z: v + dv,
        typ,
        dir: -1,
        packedAo,
      };
    case "y-":
      return {
        v0x: u,
        v0y: plane,
        v0z: v,
        v1x: u + du,
        v1y: plane,
        v1z: v,
        v2x: u + du,
        v2y: plane,
        v2z: v + dv,
        v3x: u,
        v3y: plane,
        v3z: v + dv,
        typ,
        dir: 1,
        packedAo,
      };
    case "z+":
      return {
        v0x: u,
        v0y: v,
        v0z: plane,
        v1x: u + du,
        v1y: v,
        v1z: plane,
        v2x: u + du,
        v2y: v + dv,
        v2z: plane,
        v3x: u,
        v3y: v + dv,
        v3z: plane,
        typ,
        dir: 1,
        packedAo,
      };
    case "z-":
      return {
        v0x: u,
        v0y: v,
        v0z: plane,
        v1x: u + du,
        v1y: v,
        v1z: plane,
        v2x: u + du,
        v2y: v + dv,
        v2z: plane,
        v3x: u,
        v3y: v + dv,
        v3z: plane,
        typ,
        dir: -1,
        packedAo,
      };
  }
}

function cellsUntilChunkBoundary(coord: number): number {
  return CHUNK_SIZE - (coord % CHUNK_SIZE);
}

function _createQuadVertices(
  x: number,
  y: number,
  z: number,
  face: Direction,
): Omit<BinaryQuad, "typ" | "dir" | "packedAo"> {
  switch (face) {
    case "x+":
      return {
        v0x: x + 1,
        v0y: y,
        v0z: z,
        v1x: x + 1,
        v1y: y + 1,
        v1z: z,
        v2x: x + 1,
        v2y: y + 1,
        v2z: z + 1,
        v3x: x + 1,
        v3y: y,
        v3z: z + 1,
      };
    case "x-":
      return {
        v0x: x,
        v0y: y,
        v0z: z,
        v1x: x,
        v1y: y + 1,
        v1z: z,
        v2x: x,
        v2y: y + 1,
        v2z: z + 1,
        v3x: x,
        v3y: y,
        v3z: z + 1,
      };
    case "y+":
      return {
        v0x: x,
        v0y: y + 1,
        v0z: z,
        v1x: x + 1,
        v1y: y + 1,
        v1z: z,
        v2x: x + 1,
        v2y: y + 1,
        v2z: z + 1,
        v3x: x,
        v3y: y + 1,
        v3z: z + 1,
      };
    case "y-":
      return {
        v0x: x,
        v0y: y,
        v0z: z,
        v1x: x + 1,
        v1y: y,
        v1z: z,
        v2x: x + 1,
        v2y: y,
        v2z: z + 1,
        v3x: x,
        v3y: y,
        v3z: z + 1,
      };
    case "z+":
      return {
        v0x: x,
        v0y: y,
        v0z: z + 1,
        v1x: x + 1,
        v1y: y,
        v1z: z + 1,
        v2x: x + 1,
        v2y: y + 1,
        v2z: z + 1,
        v3x: x,
        v3y: y + 1,
        v3z: z + 1,
      };
    case "z-":
      return {
        v0x: x,
        v0y: y,
        v0z: z,
        v1x: x + 1,
        v1y: y,
        v1z: z,
        v2x: x + 1,
        v2y: y + 1,
        v2z: z,
        v3x: x,
        v3y: y + 1,
        v3z: z,
      };
  }
}

async function readPersistentMesh(
  cachePath: string,
  expectedKey: string,
): Promise<ArrayBuffer | null> {
  if (!existsSync(cachePath)) return null;
  try {
    const buf = await readFile(cachePath);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const keyLen = view.getUint16(0, true);
    const storedKey = buf.subarray(2, 2 + keyLen).toString("utf8");
    if (storedKey !== expectedKey) return null;
    const mesh = buf.subarray(2 + keyLen);
    return mesh.buffer.slice(
      mesh.byteOffset,
      mesh.byteOffset + mesh.byteLength,
    );
  } catch {
    return null;
  }
}

async function writePersistentMesh(
  cachePath: string,
  key: string,
  mesh: ArrayBuffer,
): Promise<void> {
  const keyBuffer = Buffer.from(key, "utf8");
  const header = Buffer.allocUnsafe(2);
  header.writeUInt16LE(keyBuffer.length, 0);
  await writeFile(
    cachePath,
    Buffer.concat([header, keyBuffer, Buffer.from(mesh)]),
  );
}

function countChunkColumns(view: DataView, byteLength: number): number {
  const coverage = view.getUint32(byteLength - 4, true);
  let count = 0;
  for (let i = 0; i < 16; i++) {
    if ((coverage & (1 << i)) !== 0) count++;
  }
  return count;
}

function extractMaxWorldZ(view: DataView, _byteLength: number): number {
  const worldZ = view.getInt32(8, true);
  const quadCount = view.getUint32(12, true);
  const voxelSize = view.getUint32(16, true) || 1;
  const vertexCount = quadCount * 4;
  const colorPadded = (quadCount * 3 + 3) & ~3;
  const directionPadded = (quadCount + 3) & ~3;
  let off = 20 + colorPadded + directionPadded;
  let maxRelZ = 0;
  for (let i = 0; i < vertexCount; i++) {
    off += 2;
    const relZ = view.getUint16(off, true);
    if (relZ > maxRelZ) maxRelZ = relZ;
    off += 2;
  }
  return worldZ + maxRelZ * voxelSize;
}
