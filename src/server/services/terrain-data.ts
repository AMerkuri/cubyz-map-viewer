/**
 * Terrain data service for 3D map rendering.
 * Provides height + color arrays for Three.js terrain meshes.
 */

import { MAP_SIZE, type SurfaceData } from "../parsers/surface.js";
import { type ColorMapService, WATER_COLOR } from "./color-map.js";

export interface TerrainMeshData {
  width: number;
  height: number;
  /** Flat array of height values (width * height) */
  heights: number[];
  /** Flat array of RGB values (width * height * 3), each 0-255 */
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
 * Build terrain mesh data from surface data.
 * Downsamples if needed for performance.
 */
export function buildTerrainData(
  surface: SurfaceData,
  colorMap: ColorMapService,
  resolution: number = 256,
): TerrainMeshData {
  const step = Math.max(1, Math.floor(MAP_SIZE / resolution));
  const width = Math.floor(MAP_SIZE / step);
  const height = Math.floor(MAP_SIZE / step);

  const heights: number[] = new Array(width * height);
  const colors: number[] = new Array(width * height * 3);

  let minH = Infinity,
    maxH = -Infinity;

  for (let gx = 0; gx < width; gx++) {
    for (let gy = 0; gy < height; gy++) {
      const sx = gx * step;
      const sy = gy * step;
      const surfIdx = sx * MAP_SIZE + sy;

      const h = surface.heights[surfIdx];
      const biomeIdx = surface.biomes[surfIdx];
      const isWater = h < 0 || colorMap.isOceanBiome(biomeIdx);
      const color = isWater ? WATER_COLOR : colorMap.getBiomeColor(biomeIdx);

      const outIdx = gx * height + gy;
      heights[outIdx] = h;

      const factor = isWater
        ? 1.0
        : Math.max(0.75, Math.min(1.12, 1.0 + (h - 30) * 0.0015));

      colors[outIdx * 3] = Math.round(
        Math.max(0, Math.min(255, color.r * factor)),
      );
      colors[outIdx * 3 + 1] = Math.round(
        Math.max(0, Math.min(255, color.g * factor)),
      );
      colors[outIdx * 3 + 2] = Math.round(
        Math.max(0, Math.min(255, color.b * factor)),
      );

      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
    }
  }

  return {
    width,
    height,
    heights,
    colors,
    worldX: surface.worldX,
    worldY: surface.worldY,
    voxelSize: surface.voxelSize,
    minHeight: minH === Infinity ? 0 : minH,
    maxHeight: maxH === -Infinity ? 100 : maxH,
  };
}
