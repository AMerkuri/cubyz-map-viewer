/**
 * Tile renderer service.
 * Generates 256x256 PNG tiles from surface data with biome-based coloring
 * and height-based hillshading.
 */

import sharp from "sharp";
import { MAP_SIZE, type SurfaceData } from "../parsers/surface.js";
import type { ColorMapService, RGB } from "./color-map.js";

const TILE_SIZE = 256;

/**
 * Render a 256x256 PNG tile from surface data.
 * Uses biome-based coloring with height hillshading for relief.
 */
export async function renderSurfaceTile(
  surface: SurfaceData,
  colorMap: ColorMapService,
): Promise<Buffer> {
  const pixels = Buffer.alloc(TILE_SIZE * TILE_SIZE * 3);

  for (let x = 0; x < TILE_SIZE; x++) {
    for (let y = 0; y < TILE_SIZE; y++) {
      const idx = x * MAP_SIZE + y;
      const biomeIdx = surface.biomes[idx];
      const height = surface.heights[idx];

      // Get base color from biome
      const baseColor = colorMap.getBiomeColor(biomeIdx);

      // Compute hillshading factor from height differences
      let shade = 1.0;
      if (x > 0 && x < TILE_SIZE - 1 && y > 0 && y < TILE_SIZE - 1) {
        const hLeft = surface.heights[(x - 1) * MAP_SIZE + y];
        const hRight = surface.heights[(x + 1) * MAP_SIZE + y];
        const hUp = surface.heights[x * MAP_SIZE + (y - 1)];
        const hDown = surface.heights[x * MAP_SIZE + (y + 1)];

        // Simple directional lighting from top-left
        const dx = (hRight - hLeft) / 2;
        const dy = (hDown - hUp) / 2;
        shade = 1.0 + (-dx + dy) * 0.03;
        shade = Math.max(0.6, Math.min(1.4, shade));
      }

      // Apply height-based color adjustment (higher = slightly brighter)
      const heightFactor = 1.0 + (height - 30) * 0.002;
      const totalFactor = shade * Math.max(0.5, Math.min(1.3, heightFactor));

      const pixelOffset = (y * TILE_SIZE + x) * 3;
      pixels[pixelOffset] = clamp(baseColor.r * totalFactor);
      pixels[pixelOffset + 1] = clamp(baseColor.g * totalFactor);
      pixels[pixelOffset + 2] = clamp(baseColor.b * totalFactor);
    }
  }

  return sharp(pixels, {
    raw: { width: TILE_SIZE, height: TILE_SIZE, channels: 3 },
  })
    .png({ compressionLevel: 6 })
    .toBuffer();
}

/**
 * Render an empty/ocean tile with uniform color.
 */
export async function renderEmptyTile(color: RGB): Promise<Buffer> {
  const pixels = Buffer.alloc(TILE_SIZE * TILE_SIZE * 3);
  for (let i = 0; i < TILE_SIZE * TILE_SIZE; i++) {
    const offset = i * 3;
    pixels[offset] = color.r;
    pixels[offset + 1] = color.g;
    pixels[offset + 2] = color.b;
  }

  return sharp(pixels, {
    raw: { width: TILE_SIZE, height: TILE_SIZE, channels: 3 },
  })
    .png({ compressionLevel: 6 })
    .toBuffer();
}

function clamp(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}
