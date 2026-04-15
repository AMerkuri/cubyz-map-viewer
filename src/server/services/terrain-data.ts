/**
 * Terrain data service for 3D map rendering.
 * Provides height + color arrays for Three.js terrain meshes.
 */

import { MAP_SIZE, type SurfaceData } from "../parsers/surface.js";
import { type ColorMapService, WATER_COLOR } from "./color-map.js";

export const DEFAULT_TERRAIN_CELL_RESOLUTION = 128;
export const DEFAULT_TERRAIN_GUTTER = 1;

export interface TerrainMeshData {
  meshWidth: number;
  meshHeight: number;
  sampleWidth: number;
  sampleHeight: number;
  gutter: number;
  stepWorld: number;
  /** Flat array of seam-safe vertex height values (sampleWidth * sampleHeight) */
  heights: number[];
  /** Flat RGB vertex colors (sampleWidth * sampleHeight * 3), each 0-255 */
  colors: number[];
  /** World coordinate origin */
  worldX: number;
  worldY: number;
  voxelSize: number;
  /** Min/max height for camera positioning */
  minHeight: number;
  maxHeight: number;
}

/**
 * Build terrain mesh data from a same-LOD 3x3 neighborhood of surface tiles.
 *
 * The payload is a visible vertex grid plus a 1-vertex gutter so the client can
 * compute border normals with the same neighbor context on both sides of a seam.
 */
export function buildTerrainData(args: {
  centerTileX: number;
  centerTileY: number;
  surfaces: Map<string, SurfaceData>;
  colorMap: ColorMapService;
  resolution?: number;
  gutter?: number;
}): TerrainMeshData {
  const {
    centerTileX,
    centerTileY,
    surfaces,
    colorMap,
    resolution = DEFAULT_TERRAIN_CELL_RESOLUTION,
    gutter = DEFAULT_TERRAIN_GUTTER,
  } = args;

  const center = surfaces.get(surfaceTileKey(centerTileX, centerTileY));
  if (!center) {
    throw new Error("Missing center surface for terrain payload");
  }

  const stepCells = MAP_SIZE / resolution;
  if (!Number.isInteger(stepCells) || stepCells <= 0) {
    throw new Error(`Unsupported terrain resolution: ${resolution}`);
  }

  const meshWidth = resolution + 1;
  const meshHeight = resolution + 1;
  const sampleWidth = meshWidth + gutter * 2;
  const sampleHeight = meshHeight + gutter * 2;
  const heights: number[] = new Array(sampleWidth * sampleHeight);
  const colors: number[] = new Array(sampleWidth * sampleHeight * 3);

  let minH = Infinity;
  let maxH = -Infinity;

  for (let sampleX = 0; sampleX < sampleWidth; sampleX++) {
    for (let sampleY = 0; sampleY < sampleHeight; sampleY++) {
      const cornerCellX = (sampleX - gutter) * stepCells;
      const cornerCellY = (sampleY - gutter) * stepCells;
      const sample = sampleVertex(cornerCellX, cornerCellY, {
        centerTileX,
        centerTileY,
        center,
        surfaces,
        colorMap,
      });
      const outIdx = sampleX * sampleHeight + sampleY;
      heights[outIdx] = sample.height;
      colors[outIdx * 3] = sample.r;
      colors[outIdx * 3 + 1] = sample.g;
      colors[outIdx * 3 + 2] = sample.b;

      if (
        sampleX >= gutter &&
        sampleX < sampleWidth - gutter &&
        sampleY >= gutter &&
        sampleY < sampleHeight - gutter
      ) {
        if (sample.height < minH) minH = sample.height;
        if (sample.height > maxH) maxH = sample.height;
      }
    }
  }

  return {
    meshWidth,
    meshHeight,
    sampleWidth,
    sampleHeight,
    gutter,
    stepWorld: stepCells * center.voxelSize,
    heights,
    colors,
    worldX: center.worldX,
    worldY: center.worldY,
    voxelSize: center.voxelSize,
    minHeight: minH === Infinity ? 0 : minH,
    maxHeight: maxH === -Infinity ? 100 : maxH,
  };
}

function surfaceTileKey(tileX: number, tileY: number): string {
  return `${tileX}/${tileY}`;
}

function floorDiv(value: number, divisor: number): number {
  return Math.floor(value / divisor);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function colorFactor(height: number): number {
  return Math.max(0.75, Math.min(1.12, 1.0 + (height - 30) * 0.0015));
}

function sampleVertex(
  cornerCellX: number,
  cornerCellY: number,
  args: {
    centerTileX: number;
    centerTileY: number;
    center: SurfaceData;
    surfaces: Map<string, SurfaceData>;
    colorMap: ColorMapService;
  },
): { height: number; r: number; g: number; b: number } {
  let heightSum = 0;
  let redSum = 0;
  let greenSum = 0;
  let blueSum = 0;

  for (const offsetX of [-1, 0]) {
    for (const offsetY of [-1, 0]) {
      const cell = sampleCell(
        cornerCellX + offsetX,
        cornerCellY + offsetY,
        args,
      );
      heightSum += cell.height;
      redSum += cell.r;
      greenSum += cell.g;
      blueSum += cell.b;
    }
  }

  return {
    height: Math.round(heightSum / 4),
    r: Math.round(redSum / 4),
    g: Math.round(greenSum / 4),
    b: Math.round(blueSum / 4),
  };
}

function sampleCell(
  cellX: number,
  cellY: number,
  args: {
    centerTileX: number;
    centerTileY: number;
    center: SurfaceData;
    surfaces: Map<string, SurfaceData>;
    colorMap: ColorMapService;
  },
): { height: number; r: number; g: number; b: number } {
  const { centerTileX, centerTileY, center, surfaces, colorMap } = args;
  const targetTileX = centerTileX + floorDiv(cellX, MAP_SIZE);
  const targetTileY = centerTileY + floorDiv(cellY, MAP_SIZE);
  const surfaceEntry = getSurfaceEntry(surfaces, targetTileX, targetTileY) ??
    getSurfaceEntry(surfaces, centerTileX, targetTileY) ??
    getSurfaceEntry(surfaces, targetTileX, centerTileY) ?? {
      tileX: centerTileX,
      tileY: centerTileY,
      surface: center,
    };
  const { tileX, tileY, surface } = surfaceEntry;

  const localX = clamp(
    cellX - (tileX - centerTileX) * MAP_SIZE,
    0,
    MAP_SIZE - 1,
  );
  const localY = clamp(
    cellY - (tileY - centerTileY) * MAP_SIZE,
    0,
    MAP_SIZE - 1,
  );
  const surfIdx = localX * MAP_SIZE + localY;
  const height = surface.heights[surfIdx] ?? 0;
  const biomeIdx = surface.biomes[surfIdx] ?? 0;
  const isWater = height < 0 || colorMap.isOceanBiome(biomeIdx);
  const baseColor = isWater ? WATER_COLOR : colorMap.getBiomeColor(biomeIdx);
  const factor = isWater ? 1 : colorFactor(height);

  return {
    height,
    r: Math.round(Math.max(0, Math.min(255, baseColor.r * factor))),
    g: Math.round(Math.max(0, Math.min(255, baseColor.g * factor))),
    b: Math.round(Math.max(0, Math.min(255, baseColor.b * factor))),
  };
}

function getSurfaceEntry(
  surfaces: Map<string, SurfaceData>,
  tileX: number,
  tileY: number,
): { tileX: number; tileY: number; surface: SurfaceData } | null {
  const surface = surfaces.get(surfaceTileKey(tileX, tileY));
  if (!surface) {
    return null;
  }
  return { tileX, tileY, surface };
}
