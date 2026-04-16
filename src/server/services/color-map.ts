/**
 * Color map service.
 * Maps block types to average RGB colors by reading 16x16 PNG textures.
 * Also maps biomes to colors via biome -> ground_structure[0] -> block texture.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import sharp from "sharp";
import type { AssetNamespaceSource } from "../parsers/assets.js";
import type { BiomeDefinition } from "../parsers/biome.js";
import type { Palette } from "../parsers/palette.js";
import { parseZon, type ZonValue } from "../parsers/zon.js";
import { logger } from "./logger.js";

export interface RGB {
  r: number;
  g: number;
  b: number;
}

interface FallbackBlockColorLogDetails {
  reason: string;
  textureName?: string;
  texturePath?: string;
  paletteIndex?: number;
  error?: unknown;
}

interface BlockTextureFailure extends FallbackBlockColorLogDetails {}

/** Bright magenta fallback for blocks without a resolved texture color. */
export const FALLBACK_BLOCK_COLOR: RGB = { r: 255, g: 0, b: 220 };

const AIR_LIKE_BLOCK_COLOR: RGB = { r: 0, g: 0, b: 0 };
const AIR_LIKE_BLOCK_PREFIXES = ["cubyz:fog/", "cubyz:glass/"];
const BLOCK_DEFINITION_EXTENSIONS = [".zig.zon", ".zon"] as const;

const TEXTURE_FIELD_PRIORITY: Record<string, number> = {
  texture_top: 0,
  texture: 1,
  texture_side: 2,
  texture_front: 3,
  texture_back: 4,
  texture_left: 5,
  texture_right: 6,
  texture_bottom: 7,
};

/** Water color for ocean/below-sea-level areas */
export const WATER_COLOR: RGB = { r: 32, g: 56, b: 96 };

export class ColorMapService {
  /** block string ID -> RGB */
  private blockColors = new Map<string, RGB>();
  /** block string ID -> top-surface RGB used for biome/terrain colors */
  private blockTopColors = new Map<string, RGB>();
  /** block string ID -> ordered texture candidates */
  private blockTextures = new Map<string, string[]>();
  /** block string ID -> ordered top-surface texture candidates */
  private blockTopTextures = new Map<string, string[]>();
  /** block string ID -> fallback tint derived from absorbedLight */
  private blockAbsorptionColors = new Map<string, RGB>();
  /** blocks that should be treated like air */
  private airLikeBlocks = new Set<string>();
  /** block string ID -> whether we already logged a fallback color */
  private reportedFallbackBlocks = new Set<string>();
  /** biome string ID -> RGB */
  private biomeColors = new Map<string, RGB>();
  /** block palette index -> RGB (computed from palette + blockColors) */
  private paletteColors: RGB[] = [];
  /** block palette index -> whether this entry should be treated like air */
  private paletteAirLike: boolean[] = [];
  /** biome palette index -> RGB */
  private biomePaletteColors: RGB[] = [];
  /** biome palette index -> ocean flag */
  private biomePaletteIsOcean: boolean[] = [];

  async initialize(
    assetSources: readonly AssetNamespaceSource[],
    blockPalette: Palette,
    biomePalette: Palette,
    biomeDefinitions: Map<string, BiomeDefinition>,
  ): Promise<void> {
    this.reset();

    // Step 1: Parse block definitions to get texture names
    await this.loadBlockTextures(assetSources);

    // Step 2: Compute average colors from texture PNGs
    await this.computeTextureColors(assetSources);

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

  private reset(): void {
    this.blockColors.clear();
    this.blockTopColors.clear();
    this.blockTextures.clear();
    this.blockTopTextures.clear();
    this.blockAbsorptionColors.clear();
    this.airLikeBlocks.clear();
    this.reportedFallbackBlocks.clear();
    this.biomeColors.clear();
    this.paletteColors = [];
    this.paletteAirLike = [];
    this.biomePaletteColors = [];
    this.biomePaletteIsOcean = [];
  }

  private reportFallbackBlockColor(
    blockId: string,
    details: FallbackBlockColorLogDetails,
  ): void {
    if (this.isAirLikeBlock(blockId)) {
      return;
    }

    if (this.reportedFallbackBlocks.has(blockId)) {
      return;
    }

    this.reportedFallbackBlocks.add(blockId);

    const meta: Record<string, unknown> = {
      blockId,
      reason: details.reason,
      fallbackColor: FALLBACK_BLOCK_COLOR,
    };

    if (details.textureName) {
      meta.textureName = details.textureName;
    }
    if (details.texturePath) {
      meta.texturePath = details.texturePath;
    }
    if (details.paletteIndex !== undefined) {
      meta.paletteIndex = details.paletteIndex;
    }
    if (details.error !== undefined) {
      meta.error =
        details.error instanceof Error
          ? {
              name: details.error.name,
              message: details.error.message,
              stack: details.error.stack,
            }
          : String(details.error);
    }

    logger.error("Using fallback block color", meta);
  }

  private async loadBlockTextures(
    assetSources: readonly AssetNamespaceSource[],
  ): Promise<void> {
    for (const source of assetSources) {
      await this.scanBlockDir(
        join(source.rootDir, "blocks"),
        source.namespace,
        "",
      );
    }
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
      } else {
        const name = this.stripBlockDefinitionExtension(entry);
        if (!name) {
          continue;
        }

        const blockPath = subPath ? `${subPath}/${name}` : name;
        const blockId = `${prefix}:${blockPath}`;
        try {
          const text = await readFile(fullPath, "utf-8");
          const parsed = parseZon(text) as Record<string, ZonValue>;

          const textures = this.extractTextureCandidates(parsed);
          const topTextures = this.extractTopTextureCandidates(parsed);
          const absorptionColor =
            typeof parsed.absorbedLight === "number"
              ? this.absorptionToColor(parsed.absorbedLight)
              : null;
          const isAirLike = this.isInherentAirLikeBlock(blockId);

          this.clearBlockDefinition(blockId);

          if (isAirLike) {
            this.airLikeBlocks.add(blockId);
            continue;
          }

          if (textures.length > 0) {
            this.blockTextures.set(blockId, textures);
          }

          if (topTextures.length > 0) {
            this.blockTopTextures.set(blockId, topTextures);
          }

          if (absorptionColor) {
            this.blockAbsorptionColors.set(blockId, absorptionColor);
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
    namespace: string,
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
        await this.scanTextureDir(baseDir, fullPath, namespace, out);
      } else if (
        entry.endsWith(".png") &&
        !entry.includes("_emission") &&
        !entry.includes("_reflectivity")
      ) {
        // Build texture name relative to base textures dir, e.g. "cubyz:leaves/oak"
        const rel = fullPath.slice(baseDir.length + 1).replace(/\\/g, "/");
        const name = rel.slice(0, -".png".length);
        out.set(`${namespace}:${name}`, fullPath);
      }
    }
  }

  private async computeTextureColors(
    assetSources: readonly AssetNamespaceSource[],
  ): Promise<void> {
    // Build a map of texture name -> file path by scanning subdirectories recursively.
    // Texture names use slash-separated paths relative to the textures dir, e.g.
    // "cubyz:leaves/oak" maps to textures/leaves/oak.png.
    const textureFiles = new Map<string, string>();

    for (const source of assetSources) {
      const texturesDir = join(source.rootDir, "blocks", "textures");
      await this.scanTextureDir(
        texturesDir,
        texturesDir,
        source.namespace,
        textureFiles,
      );
    }

    // Compute average color for each block that has a texture
    for (const [blockId, textureNames] of this.blockTextures) {
      const { color, failure } = await this.resolveBlockColor(
        blockId,
        textureNames,
        textureFiles,
      );
      if (color) {
        this.blockColors.set(blockId, color);
        continue;
      }

      if (failure) {
        this.reportFallbackBlockColor(blockId, failure);
      }
    }

    for (const [blockId, textureNames] of this.blockTopTextures) {
      const { color } = await this.resolveBlockColor(
        blockId,
        textureNames,
        textureFiles,
      );
      if (color) {
        this.blockTopColors.set(blockId, color);
      }
    }
  }

  private async averageTextureColor(pngPath: string): Promise<RGB | null> {
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

    if (totalAlpha === 0) return null;

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
        const color =
          this.blockTopColors.get(biome.topBlock) ??
          this.blockColors.get(biome.topBlock);
        if (color) {
          this.biomeColors.set(biomeId, color);
        }
      }
    }
  }

  private buildPaletteColors(palette: Palette): void {
    this.paletteColors = new Array(palette.entries.length);
    this.paletteAirLike = new Array(palette.entries.length);
    for (let i = 0; i < palette.entries.length; i++) {
      const blockId = palette.entries[i];
      const isAirLike = this.isAirLikeBlock(blockId);
      this.paletteAirLike[i] = isAirLike;
      if (isAirLike) {
        this.paletteColors[i] = AIR_LIKE_BLOCK_COLOR;
        continue;
      }

      const color = this.blockColors.get(blockId);
      if (color) {
        this.paletteColors[i] = color;
        continue;
      }

      this.reportFallbackBlockColor(blockId, {
        reason: this.blockTextures.has(blockId)
          ? "texture color unavailable"
          : "block has no texture mapping",
        textureName: this.blockTextures.get(blockId)?.[0],
        paletteIndex: i,
      });
      this.paletteColors[i] = FALLBACK_BLOCK_COLOR;
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
    if (this.paletteAirLike[paletteIndex] === true) {
      return AIR_LIKE_BLOCK_COLOR;
    }
    return this.paletteColors[paletteIndex] ?? FALLBACK_BLOCK_COLOR;
  }

  /** Check if a block palette index should be treated like air */
  isBlockPaletteIndexAirLike(paletteIndex: number): boolean {
    return this.paletteAirLike[paletteIndex] === true;
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
    if (this.isAirLikeBlock(blockId)) {
      return AIR_LIKE_BLOCK_COLOR;
    }

    const color = this.blockColors.get(blockId);
    if (color) {
      return color;
    }

    this.reportFallbackBlockColor(blockId, {
      reason: this.blockTextures.has(blockId)
        ? "texture color unavailable"
        : "block has no texture mapping",
      textureName: this.blockTextures.get(blockId)?.[0],
    });
    return FALLBACK_BLOCK_COLOR;
  }

  /** Get all block colors as a JSON-serializable object */
  getAllBlockColors(): Record<string, RGB> {
    const result: Record<string, RGB> = {};
    for (const [id, color] of this.blockColors) {
      result[id] = color;
    }
    return result;
  }

  private isAirLikeBlock(blockId: string): boolean {
    return (
      this.isInherentAirLikeBlock(blockId) || this.airLikeBlocks.has(blockId)
    );
  }

  private isInherentAirLikeBlock(blockId: string): boolean {
    return (
      blockId === "cubyz:air" ||
      AIR_LIKE_BLOCK_PREFIXES.some((prefix) => blockId.startsWith(prefix))
    );
  }

  private clearBlockDefinition(blockId: string): void {
    this.blockTextures.delete(blockId);
    this.blockTopTextures.delete(blockId);
    this.blockAbsorptionColors.delete(blockId);
    this.airLikeBlocks.delete(blockId);
  }

  private stripBlockDefinitionExtension(entry: string): string | null {
    for (const extension of BLOCK_DEFINITION_EXTENSIONS) {
      if (entry.endsWith(extension)) {
        return basename(entry, extension);
      }
    }

    return null;
  }

  private extractTextureCandidates(parsed: Record<string, ZonValue>): string[] {
    const textures: string[] = [];

    const pushTexture = (value: ZonValue | undefined) => {
      if (typeof value === "string" && !textures.includes(value)) {
        textures.push(value);
      }
    };

    const prioritizedFields = [
      parsed.texture_top,
      parsed.texture,
      parsed.texture_side,
      parsed.texture_front,
      parsed.texture_back,
      parsed.texture_left,
      parsed.texture_right,
    ];
    for (const texture of prioritizedFields) {
      pushTexture(texture);
    }

    const numberedEntries = Object.entries(parsed)
      .filter(
        ([key, value]) => /^texture\d+$/.test(key) && typeof value === "string",
      )
      .sort(([left], [right]) => this.compareTextureFields(left, right));
    for (const [_key, value] of numberedEntries) {
      pushTexture(value);
    }

    if (textures.length === 0) {
      pushTexture(parsed.texture_bottom);

      const fallbackEntries = Object.entries(parsed)
        .filter(
          ([key, value]) =>
            this.isTextureField(key) &&
            typeof value === "string" &&
            !/^texture\d+$/.test(key),
        )
        .sort(([left], [right]) => this.compareTextureFields(left, right));
      for (const [_key, value] of fallbackEntries) {
        pushTexture(value);
      }
    }

    return textures;
  }

  private extractTopTextureCandidates(
    parsed: Record<string, ZonValue>,
  ): string[] {
    const topTextures: string[] = [];
    const pushTexture = (value: ZonValue | undefined) => {
      if (typeof value === "string" && !topTextures.includes(value)) {
        topTextures.push(value);
      }
    };

    pushTexture(parsed.texture_top);
    pushTexture(parsed.texture);

    if (topTextures.length > 0) {
      return topTextures;
    }

    const numberedTopFaces = [parsed.texture2, parsed.texture3];
    for (const texture of numberedTopFaces) {
      pushTexture(texture);
    }

    return topTextures;
  }

  private isTextureField(key: string): boolean {
    return (
      key === "texture" ||
      key.startsWith("texture_") ||
      /^texture\d+$/.test(key)
    );
  }

  private compareTextureFields(left: string, right: string): number {
    const leftPriority = this.textureFieldPriority(left);
    const rightPriority = this.textureFieldPriority(right);
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }
    return left.localeCompare(right);
  }

  private textureFieldPriority(key: string): number {
    if (key in TEXTURE_FIELD_PRIORITY) {
      return TEXTURE_FIELD_PRIORITY[key];
    }

    const numberedMatch = /^texture(\d+)$/.exec(key);
    if (numberedMatch) {
      return 100 + parseInt(numberedMatch[1], 10);
    }

    return 1000;
  }

  private absorptionToColor(absorbedLight: number): RGB {
    return {
      r: 255 - ((absorbedLight >> 16) & 0xff),
      g: 255 - ((absorbedLight >> 8) & 0xff),
      b: 255 - (absorbedLight & 0xff),
    };
  }

  private async resolveBlockColor(
    blockId: string,
    textureNames: string[],
    textureFiles: Map<string, string>,
  ): Promise<{ color: RGB | null; failure?: BlockTextureFailure }> {
    const resolvedColors: RGB[] = [];
    let failure: BlockTextureFailure | undefined;

    for (const textureName of textureNames) {
      const texturePath = textureFiles.get(textureName);
      if (!texturePath) {
        failure ??= {
          reason: "texture file not found",
          textureName,
        };
        continue;
      }

      try {
        const color = await this.averageTextureColor(texturePath);
        if (color) {
          resolvedColors.push(color);
          continue;
        }

        const transparentFallback = await this.resolveTransparentTextureColor(
          blockId,
          textureName,
          textureFiles,
        );
        if (transparentFallback) {
          resolvedColors.push(transparentFallback);
          continue;
        }

        failure ??= {
          reason: "texture is fully transparent",
          textureName,
          texturePath,
        };
      } catch (error) {
        failure ??= {
          reason: "failed to average texture color",
          textureName,
          texturePath,
          error,
        };
      }
    }

    if (resolvedColors.length === 0) {
      return { color: null, failure };
    }

    return { color: this.averageResolvedColors(resolvedColors) };
  }

  private async resolveTransparentTextureColor(
    blockId: string,
    textureName: string,
    textureFiles: Map<string, string>,
  ): Promise<RGB | null> {
    const absorptionPath = textureFiles.get(`${textureName}_absorption`);
    if (absorptionPath) {
      try {
        const color = await this.averageTextureColor(absorptionPath);
        if (color) {
          return color;
        }
      } catch {
        // Fall back to absorbedLight-derived tint below.
      }
    }

    return this.blockAbsorptionColors.get(blockId) ?? null;
  }

  private averageResolvedColors(colors: RGB[]): RGB {
    let r = 0;
    let g = 0;
    let b = 0;

    for (const color of colors) {
      r += (color.r / 255) ** 2.2;
      g += (color.g / 255) ** 2.2;
      b += (color.b / 255) ** 2.2;
    }

    return {
      r: Math.round((r / colors.length) ** (1 / 2.2) * 255),
      g: Math.round((g / colors.length) ** (1 / 2.2) * 255),
      b: Math.round((b / colors.length) ** (1 / 2.2) * 255),
    };
  }
}
