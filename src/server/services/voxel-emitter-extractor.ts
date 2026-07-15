import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { CHUNK_SIZE, REGION_SIZE, type RegionData } from "../parsers/region.js";
import { MAP_SIZE, parseSurfaceFile } from "../parsers/surface.js";
import type { BlockColorTable } from "./block-color-table.js";
import {
  type BlockShapeTable,
  resolveShapeForLod,
} from "./block-shape-table.js";
import { logger } from "./logger.js";
import { loadVoxelRegionFile } from "./voxel-column-source.js";
import {
  EMITTER_OPEN_FACE_Z_NEG,
  getBlockData,
  getEmittedLight,
  getEmitterOpenFaces,
  getPaletteIndex,
  getRepresentedLodMask,
  hasDetailedRepresentation,
  isAirType,
  isTraversableBlockValue,
  type RepresentedEmitterSource,
} from "./voxel-emitter-semantics.js";

const COLUMN_VOXELS = CHUNK_SIZE * REGION_SIZE;
const CHUNK_VOLUME = CHUNK_SIZE ** 3;
const MAX_ENTRANCE_DEPTH_WORLD = 64;

interface RepresentedEmitterExtractionMetrics {
  regionsParsed: number;
  chunksInspected: number;
  sourceCount: number;
  elapsedMs: number;
}

interface RepresentedEmitterExtractionResult {
  sources: RepresentedEmitterSource[];
  metrics: RepresentedEmitterExtractionMetrics;
}

export async function extractLod1RepresentedEmitters(
  savePath: string,
  blockColors: BlockColorTable,
  blockShapes: BlockShapeTable,
  regionX: number,
  regionY: number,
): Promise<RepresentedEmitterExtractionResult> {
  const startedAt = performance.now();
  const empty = (): RepresentedEmitterExtractionResult => ({
    sources: [],
    metrics: {
      regionsParsed,
      chunksInspected,
      sourceCount: 0,
      elapsedMs: performance.now() - startedAt,
    },
  });
  let regionsParsed = 0;
  let chunksInspected = 0;
  const columnDirectory = columnPath(savePath, regionX, regionY);
  if (!existsSync(columnDirectory)) return empty();

  const regionZs = await listRegionZs(columnDirectory);
  if (regionZs.length === 0) return empty();
  const surfaceHeights = await loadSurfaceHeights(savePath, regionX, regionY);
  if (!surfaceHeights) return empty();

  const minZ = Math.min(...regionZs);
  const maxZ = Math.max(...regionZs) + COLUMN_VOXELS - 1;
  const regionLoads = new Map<string, Promise<RegionData | null>>();

  function loadRegion(
    columnX: number,
    columnY: number,
    worldZ: number,
  ): Promise<RegionData | null> {
    const key = `${columnX}/${columnY}/${worldZ}`;
    const cached = regionLoads.get(key);
    if (cached) return cached;
    const path = join(
      columnPath(savePath, columnX, columnY),
      `${worldZ}.region`,
    );
    const pending = loadVoxelRegionFile(path, columnX, columnY, worldZ, 1).then(
      (loaded) => {
        if (loaded.status === "parsed") {
          regionsParsed++;
          return loaded.region;
        }
        if (loaded.status === "error") {
          logger.warn("Failed to parse emitter extraction region", {
            path,
            regionX: columnX,
            regionY: columnY,
            regionWorldZ: worldZ,
            error:
              loaded.error instanceof Error
                ? loaded.error.message
                : String(loaded.error),
          });
        }
        return null;
      },
    );
    regionLoads.set(key, pending);
    return pending;
  }

  async function getBlockValue(
    x: number,
    y: number,
    z: number,
  ): Promise<number> {
    if (z < minZ || z > maxZ) return 0;
    const columnX = Math.floor(x / COLUMN_VOXELS) * COLUMN_VOXELS;
    const columnY = Math.floor(y / COLUMN_VOXELS) * COLUMN_VOXELS;
    const worldZ = Math.floor(z / COLUMN_VOXELS) * COLUMN_VOXELS;
    const region = await loadRegion(columnX, columnY, worldZ);
    if (!region) return 0;
    const localX = x - columnX;
    const localY = y - columnY;
    const localZ = z - worldZ;
    const chunkX = Math.floor(localX / CHUNK_SIZE);
    const chunkY = Math.floor(localY / CHUNK_SIZE);
    const chunkZ = Math.floor(localZ / CHUNK_SIZE);
    const chunk =
      region.chunks[
        chunkX * REGION_SIZE * REGION_SIZE + chunkY * REGION_SIZE + chunkZ
      ];
    if (!chunk) return 0;
    return (
      chunk.blocks[
        localIndex(
          localX % CHUNK_SIZE,
          localY % CHUNK_SIZE,
          localZ % CHUNK_SIZE,
        )
      ] ?? 0
    );
  }

  const sources: RepresentedEmitterSource[] = [];
  for (const worldZ of regionZs) {
    const region = await loadRegion(regionX, regionY, worldZ);
    if (!region) continue;
    for (const chunk of region.chunks) {
      if (!chunk) continue;
      chunksInspected++;
      for (let index = 0; index < CHUNK_VOLUME; index++) {
        const blockValue = chunk.blocks[index] ?? 0;
        const paletteIndex = getPaletteIndex(blockValue);
        if (isAirType(blockColors, paletteIndex)) continue;
        const light = getEmittedLight(blockColors, paletteIndex);
        if (!light) continue;
        const shape = resolveShapeForLod(blockShapes, paletteIndex, 1);
        if (!hasDetailedRepresentation(shape, getBlockData(blockValue)))
          continue;

        const localX = Math.floor(index / (CHUNK_SIZE * CHUNK_SIZE));
        const localY = Math.floor(
          (index % (CHUNK_SIZE * CHUNK_SIZE)) / CHUNK_SIZE,
        );
        const localZ = index % CHUNK_SIZE;
        const x = regionX + chunk.rx * CHUNK_SIZE + localX;
        const y = regionY + chunk.ry * CHUNK_SIZE + localY;
        const z = worldZ + chunk.rz * CHUNK_SIZE + localZ;
        const surfaceHeight =
          surfaceHeights[(x - regionX) * COLUMN_VOXELS + (y - regionY)] ?? 0;
        if (z < surfaceHeight - MAX_ENTRANCE_DEPTH_WORLD) continue;

        const traversableFaces = await getEmitterOpenFaces(
          x,
          y,
          z,
          async (nx, ny, nz) =>
            isTraversableBlockValue(
              blockColors,
              blockShapes,
              await getBlockValue(nx, ny, nz),
              1,
            ),
        );
        const openFaces =
          shape.kind === "cube"
            ? traversableFaces & ~EMITTER_OPEN_FACE_Z_NEG
            : traversableFaces;
        if ((openFaces & ~EMITTER_OPEN_FACE_Z_NEG) === 0) continue;
        sources.push({
          x,
          y,
          z,
          ...light,
          openFaces,
          representedLods: getRepresentedLodMask(blockShapes, paletteIndex),
        });
      }
    }
  }

  sources.sort(
    (left, right) => left.x - right.x || left.y - right.y || left.z - right.z,
  );
  return {
    sources,
    metrics: {
      regionsParsed,
      chunksInspected,
      sourceCount: sources.length,
      elapsedMs: performance.now() - startedAt,
    },
  };
}

async function listRegionZs(directory: string): Promise<number[]> {
  return (await readdir(directory))
    .filter((entry) => entry.endsWith(".region"))
    .map((entry) => Number.parseInt(entry.slice(0, -7), 10))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
}

async function loadSurfaceHeights(
  savePath: string,
  regionX: number,
  regionY: number,
): Promise<Int32Array | null> {
  const tileX = Math.floor(regionX / MAP_SIZE) * MAP_SIZE;
  const tileY = Math.floor(regionY / MAP_SIZE) * MAP_SIZE;
  const path = join(savePath, "maps", "1", String(tileX), `${tileY}.surface`);
  if (!existsSync(path)) return null;
  try {
    const surface = await parseSurfaceFile(path, tileX, tileY, 1);
    const heights = new Int32Array(COLUMN_VOXELS * COLUMN_VOXELS);
    const offsetX = regionX - tileX;
    const offsetY = regionY - tileY;
    for (let x = 0; x < COLUMN_VOXELS; x++) {
      for (let y = 0; y < COLUMN_VOXELS; y++) {
        heights[x * COLUMN_VOXELS + y] =
          surface.heights[(offsetX + x) * MAP_SIZE + offsetY + y] ?? 0;
      }
    }
    return heights;
  } catch (error) {
    logger.warn("Surface read failed for emitter extraction", {
      regionX,
      regionY,
      sourcePath: path,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function columnPath(
  savePath: string,
  regionX: number,
  regionY: number,
): string {
  return join(savePath, "chunks", "1", String(regionX), String(regionY));
}

function localIndex(x: number, y: number, z: number): number {
  return x * CHUNK_SIZE * CHUNK_SIZE + y * CHUNK_SIZE + z;
}
