/**
 * Color map service.
 * Maps block types to average RGB colors by reading 16x16 PNG textures.
 * Also maps biomes to colors via biome -> ground_structure[0] -> block texture.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import sharp from "sharp";
import type { BiomeDefinition } from "../parsers/biome.js";
import type { Palette } from "../parsers/palette.js";
import { parseZon, type ZonValue } from "../parsers/zon.js";
import { logger } from "./logger.js";

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** Light purple fallback for blocks without a resolved texture color. */
export const FALLBACK_BLOCK_COLOR: RGB = { r: 200, g: 160, b: 255 };

/** Water color for ocean/below-sea-level areas */
export const WATER_COLOR: RGB = { r: 32, g: 56, b: 96 };

export class ColorMapService {
  /** block string ID -> RGB */
  private blockColors = new Map<string, RGB>();
  /** block string ID -> texture name */
  private blockTextures = new Map<string, string>();
  /** biome string ID -> RGB */
  private biomeColors = new Map<string, RGB>();
  /** block palette index -> RGB (computed from palette + blockColors) */
  private paletteColors: RGB[] = [];
  /** biome palette index -> RGB */
  private biomePaletteColors: RGB[] = [];
  /** biome palette index -> ocean flag */
  private biomePaletteIsOcean: boolean[] = [];

  async initialize(
    cubyzAssetsPath: string,
    blockPalette: Palette,
    biomePalette: Palette,
    biomeDefinitions: Map<string, BiomeDefinition>,
  ): Promise<void> {
    // Step 1: Parse block definitions to get texture names
    await this.loadBlockTextures(join(cubyzAssetsPath, "blocks"));

    // Step 2: Compute average colors from texture PNGs
    await this.computeTextureColors(
      join(cubyzAssetsPath, "blocks", "textures"),
    );

    // Step 3: Build biome -> color mapping via ground_structure
    this.buildBiomeColors(biomeDefinitions);

    // Step 4: Build palette-indexed color arrays for fast lookup
    this.buildPaletteColors(blockPalette);
    this.buildBiomePaletteColors(biomePalette, biomeDefinitions);

    logger.info("Color map initialized", {
      blockColors: this.blockColors.size,
      biomeColors: this.biomeColors.size,
    });
  }

  private async loadBlockTextures(blocksDir: string): Promise<void> {
    await this.scanBlockDir(blocksDir, "cubyz", "");
  }

  private async scanBlockDir(
    baseDir: string,
    prefix: string,
    subPath: string,
  ): Promise<void> {
    const dirPath = subPath ? join(baseDir, subPath) : baseDir;
    let entries: string[];
    try {
      entries = await readdir(dirPath);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry === "textures") continue; // Skip textures subdir
      const fullPath = join(dirPath, entry);
      const st = await stat(fullPath);

      if (st.isDirectory()) {
        const nextSub = subPath ? `${subPath}/${entry}` : entry;
        await this.scanBlockDir(baseDir, prefix, nextSub);
      } else if (entry.endsWith(".zig.zon")) {
        const name = basename(entry, ".zig.zon");
        const blockPath = subPath ? `${subPath}/${name}` : name;
        const blockId = `${prefix}:${blockPath}`;
        try {
          const text = await readFile(fullPath, "utf-8");
          const parsed = parseZon(text) as Record<string, ZonValue>;
          // Use texture_top or texture field
          const texture = parsed.texture_top ?? parsed.texture;
          if (texture && typeof texture === "string") {
            this.blockTextures.set(blockId, texture);
          }
        } catch {
          // Skip unparseable block definitions
        }
      }
    }
  }

  private async scanTextureDir(
    baseDir: string,
    currentDir: string,
    out: Map<string, string>,
  ): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(currentDir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(currentDir, entry);
      const st = await stat(fullPath);

      if (st.isDirectory()) {
        await this.scanTextureDir(baseDir, fullPath, out);
      } else if (
        entry.endsWith(".png") &&
        !entry.includes("_emission") &&
        !entry.includes("_reflectivity") &&
        !entry.includes("_absorption")
      ) {
        // Build texture name relative to base textures dir, e.g. "cubyz:leaves/oak"
        const rel = fullPath.slice(baseDir.length + 1).replace(/\\/g, "/");
        const name = rel.slice(0, -".png".length);
        out.set(`cubyz:${name}`, fullPath);
      }
    }
  }

  private async computeTextureColors(texturesDir: string): Promise<void> {
    // Build a map of texture name -> file path by scanning subdirectories recursively.
    // Texture names use slash-separated paths relative to the textures dir, e.g.
    // "cubyz:leaves/oak" maps to textures/leaves/oak.png.
    const textureFiles = new Map<string, string>();
    await this.scanTextureDir(texturesDir, texturesDir, textureFiles);

    // Compute average color for each block that has a texture
    for (const [blockId, textureName] of this.blockTextures) {
      const texPath = textureFiles.get(textureName);
      if (texPath) {
        try {
          const color = await this.averageTextureColor(texPath);
          this.blockColors.set(blockId, color);
        } catch {
          // Use fallback if available
        }
      }
    }
  }

  private async averageTextureColor(pngPath: string): Promise<RGB> {
    const { data, info } = await sharp(pngPath)
      .raw()
      .ensureAlpha()
      .toBuffer({ resolveWithObject: true });

    let r = 0,
      g = 0,
      b = 0,
      totalAlpha = 0;
    const pixels = info.width * info.height;

    for (let i = 0; i < pixels; i++) {
      const offset = i * 4;
      const a = data[offset + 3] / 255;
      // Gamma-correct averaging (work in linear space)
      r += (data[offset] / 255) ** 2.2 * a;
      g += (data[offset + 1] / 255) ** 2.2 * a;
      b += (data[offset + 2] / 255) ** 2.2 * a;
      totalAlpha += a;
    }

    if (totalAlpha === 0) return FALLBACK_BLOCK_COLOR;

    return {
      r: Math.round((r / totalAlpha) ** (1 / 2.2) * 255),
      g: Math.round((g / totalAlpha) ** (1 / 2.2) * 255),
      b: Math.round((b / totalAlpha) ** (1 / 2.2) * 255),
    };
  }

  private buildBiomeColors(
    biomeDefinitions: Map<string, BiomeDefinition>,
  ): void {
    for (const [biomeId, biome] of biomeDefinitions) {
      if (biome.topBlock) {
        const color = this.blockColors.get(biome.topBlock);
        if (color) {
          this.biomeColors.set(biomeId, color);
        }
      }
    }
  }

  private buildPaletteColors(palette: Palette): void {
    this.paletteColors = new Array(palette.entries.length);
    for (let i = 0; i < palette.entries.length; i++) {
      const blockId = palette.entries[i];
      this.paletteColors[i] =
        this.blockColors.get(blockId) ?? FALLBACK_BLOCK_COLOR;
    }
  }

  private buildBiomePaletteColors(
    palette: Palette,
    biomeDefinitions: Map<string, BiomeDefinition>,
  ): void {
    this.biomePaletteColors = new Array(palette.entries.length);
    this.biomePaletteIsOcean = new Array(palette.entries.length);
    for (let i = 0; i < palette.entries.length; i++) {
      const biomeId = palette.entries[i];
      const biomeDef = biomeDefinitions.get(biomeId);
      this.biomePaletteColors[i] = this.biomeColors.get(biomeId) ?? {
        r: 100,
        g: 140,
        b: 80,
      };
      this.biomePaletteIsOcean[i] =
        biomeDef?.isOcean === true || biomeId.includes(":ocean/");
    }
  }

  /** Get color for a block palette index */
  getBlockColor(paletteIndex: number): RGB {
    return this.paletteColors[paletteIndex] ?? FALLBACK_BLOCK_COLOR;
  }

  /** Get color for a biome palette index */
  getBiomeColor(biomeIndex: number): RGB {
    return this.biomePaletteColors[biomeIndex] ?? { r: 100, g: 140, b: 80 };
  }

  /** Check if a biome palette index is an ocean biome */
  isOceanBiome(biomeIndex: number): boolean {
    return this.biomePaletteIsOcean[biomeIndex] === true;
  }

  /** Get color for a named block */
  getBlockColorByName(blockId: string): RGB {
    return this.blockColors.get(blockId) ?? FALLBACK_BLOCK_COLOR;
  }

  /** Get all block colors as a JSON-serializable object */
  getAllBlockColors(): Record<string, RGB> {
    const result: Record<string, RGB> = {};
    for (const [id, color] of this.blockColors) {
      result[id] = color;
    }
    return result;
  }
}
