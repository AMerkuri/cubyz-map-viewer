import type { Stats } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { AssetNamespaceSource } from "../parsers/assets.js";
import { parseZon, type ZonValue } from "../parsers/zon.js";
import { logger } from "./logger.js";

type EntityModelAssetType = "model" | "texture";

interface EntityModelDescriptor {
  id: string;
  namespace: string;
  modelRef: string;
  textureRef: string;
  height: number;
  coordinateSystem: string | null;
  tags: Set<string>;
  modelPath: string;
  texturePath: string;
}

interface ResolvedEntityAsset {
  path: string;
  extension: string;
}

interface PlayerMarkerAssetManifest {
  available: boolean;
  entityModelId: string | null;
  modelUrl: string | null;
  textureUrl: string | null;
  height: number | null;
  coordinateSystem: string | null;
}

const ENTITY_MODEL_DESCRIPTOR_EXT = ".zig.zon";
const ENTITY_MODEL_TAG = "playerModel";
const DEFAULT_PLAYER_MODEL_ID = "cubyz:snale";
const FALLBACK_HEIGHT = 2;

/**
 * Avatars the viewer explicitly renders as player markers. These are allowed
 * even when their descriptor lacks the `.playerModel` tag, because Cubyz's
 * `/avatar` command can assign any entity model to a player.
 */
const SUPPORTED_PLAYER_MODEL_IDS = new Set<string>([
  "cubyz:snale",
  "cubyz:snail",
  "cubyz:moffalo",
  "cubyz:cubert",
]);

const UNAVAILABLE_MANIFEST: PlayerMarkerAssetManifest = {
  available: false,
  entityModelId: null,
  modelUrl: null,
  textureUrl: null,
  height: null,
  coordinateSystem: null,
};

export class EntityModelAssetService {
  private readonly assetFiles = new Map<string, string>();
  private readonly manifestsByModelId = new Map<
    string,
    PlayerMarkerAssetManifest
  >();
  private descriptorsPromise: Promise<
    Map<string, EntityModelDescriptor>
  > | null = null;

  constructor(private readonly assetSources: readonly AssetNamespaceSource[]) {}

  /**
   * Resolve the player marker manifest for a specific supported avatar model
   * ID. Missing or unloadable avatars resolve to an unavailable manifest rather
   * than throwing, so player data loading never fails.
   */
  async getPlayerMarkerManifestById(
    entityModelId: string,
  ): Promise<PlayerMarkerAssetManifest> {
    const cached = this.manifestsByModelId.get(entityModelId);
    if (cached) {
      return cached;
    }

    let descriptors: Map<string, EntityModelDescriptor>;
    try {
      descriptors = await this.getPlayerModelDescriptors();
    } catch (error) {
      logger.warn("Failed to load entity model descriptors", {
        entityModelId,
        error: error instanceof Error ? error.message : String(error),
      });
      this.manifestsByModelId.set(entityModelId, UNAVAILABLE_MANIFEST);
      return UNAVAILABLE_MANIFEST;
    }

    const selected = descriptors.get(entityModelId);
    if (!selected) {
      this.manifestsByModelId.set(entityModelId, UNAVAILABLE_MANIFEST);
      return UNAVAILABLE_MANIFEST;
    }

    const modelToken = this.registerAssetFile("model", selected.modelPath);
    const textureToken = this.registerAssetFile(
      "texture",
      selected.texturePath,
    );
    const manifest: PlayerMarkerAssetManifest = {
      available: true,
      entityModelId: selected.id,
      modelUrl: `/api/assets/entity-models/files/${modelToken}`,
      textureUrl: `/api/assets/entity-models/files/${textureToken}`,
      height: selected.height,
      coordinateSystem: selected.coordinateSystem,
    };
    this.manifestsByModelId.set(entityModelId, manifest);
    return manifest;
  }

  /**
   * Legacy default player marker manifest. Resolves the `cubyz:snale` avatar
   * using the same descriptor and asset resolution rules.
   */
  async getPlayerMarkerManifest(): Promise<PlayerMarkerAssetManifest> {
    return this.getPlayerMarkerManifestById(DEFAULT_PLAYER_MODEL_ID);
  }

  async getEntityModelAssetFile(token: string): Promise<string | null> {
    return this.assetFiles.get(token) ?? null;
  }

  private getPlayerModelDescriptors(): Promise<
    Map<string, EntityModelDescriptor>
  > {
    if (!this.descriptorsPromise) {
      this.descriptorsPromise = this.loadPlayerModelDescriptors();
    }
    return this.descriptorsPromise;
  }

  private async loadPlayerModelDescriptors(): Promise<
    Map<string, EntityModelDescriptor>
  > {
    const descriptors = new Map<string, EntityModelDescriptor>();

    for (const source of this.assetSources) {
      await this.scanDescriptorDir(
        source,
        join(source.rootDir, "entityModels"),
        "",
        descriptors,
      );
    }

    const playerModels = new Map<string, EntityModelDescriptor>();
    for (const descriptor of descriptors.values()) {
      if (
        descriptor.tags.has(ENTITY_MODEL_TAG) ||
        SUPPORTED_PLAYER_MODEL_IDS.has(descriptor.id)
      ) {
        playerModels.set(descriptor.id, descriptor);
      }
    }
    return playerModels;
  }

  private async scanDescriptorDir(
    source: AssetNamespaceSource,
    dirPath: string,
    relativeDir: string,
    descriptors: Map<string, EntityModelDescriptor>,
  ): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(dirPath);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dirPath, entry);
      let entryStat: Stats;
      try {
        entryStat = await stat(fullPath);
      } catch {
        continue;
      }

      const relativePath = relativeDir ? `${relativeDir}/${entry}` : entry;
      if (entryStat.isDirectory()) {
        await this.scanDescriptorDir(
          source,
          fullPath,
          relativePath,
          descriptors,
        );
        continue;
      }

      if (!entry.endsWith(ENTITY_MODEL_DESCRIPTOR_EXT)) {
        continue;
      }

      const descriptor = await this.parseDescriptor(
        source,
        fullPath,
        relativePath,
      );
      if (!descriptor) {
        continue;
      }
      descriptors.set(descriptor.id, descriptor);
    }
  }

  private async parseDescriptor(
    source: AssetNamespaceSource,
    filePath: string,
    relativePath: string,
  ): Promise<EntityModelDescriptor | null> {
    try {
      const text = await readFile(filePath, "utf-8");
      const parsed = parseZon(text) as Record<string, ZonValue>;
      const id = `${source.namespace}:${relativePath.slice(0, -ENTITY_MODEL_DESCRIPTOR_EXT.length)}`;
      const modelRef = this.readAssetRef(parsed.model, source.namespace);
      const textureRef = this.readAssetRef(
        parsed.defaultTexture,
        source.namespace,
      );
      if (!modelRef || !textureRef) {
        return null;
      }

      const model = await this.resolveEntityModelAsset(modelRef, "model");
      const texture = await this.resolveEntityModelAsset(textureRef, "texture");
      if (!model || !texture) {
        return null;
      }

      return {
        id,
        namespace: source.namespace,
        modelRef,
        textureRef,
        height: this.readHeight(parsed.height),
        coordinateSystem: this.readString(parsed.coordinateSystem),
        tags: this.readTags(parsed.tags),
        modelPath: model.path,
        texturePath: texture.path,
      };
    } catch (error) {
      logger.warn("Skipping entity model descriptor", {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async resolveEntityModelAsset(
    ref: string,
    type: EntityModelAssetType,
  ): Promise<ResolvedEntityAsset | null> {
    const parsed = this.parseNamespacedRef(ref);
    if (!parsed) {
      return null;
    }

    const extension = type === "model" ? ".glb" : ".png";
    const dir = type === "model" ? "models" : "textures";
    const pathSegments = parsed.path.split("/").filter(Boolean);
    if (pathSegments.length === 0) {
      return null;
    }

    for (let index = this.assetSources.length - 1; index >= 0; index--) {
      const source = this.assetSources[index];
      if (!source || source.namespace !== parsed.namespace) {
        continue;
      }
      const filePath = join(
        source.rootDir,
        "entityModels",
        dir,
        ...pathSegments,
      );
      const resolvedPath = filePath.endsWith(extension)
        ? filePath
        : `${filePath}${extension}`;
      try {
        await stat(resolvedPath);
        return { path: resolvedPath, extension };
      } catch {}
    }

    return null;
  }

  private parseNamespacedRef(
    ref: string,
  ): { namespace: string; path: string } | null {
    const separator = ref.indexOf(":");
    if (separator <= 0 || separator === ref.length - 1) {
      return null;
    }
    const namespace = ref.slice(0, separator);
    const path = ref.slice(separator + 1);
    if (
      !/^[A-Za-z0-9._-]+$/.test(namespace) ||
      path.includes("..") ||
      !/^[A-Za-z0-9._/-]+$/.test(path)
    ) {
      return null;
    }
    return { namespace, path };
  }

  private readAssetRef(
    value: ZonValue | undefined,
    fallbackNamespace: string,
  ): string | null {
    const ref = this.readString(value);
    if (!ref) {
      return null;
    }
    return ref.includes(":") ? ref : `${fallbackNamespace}:${ref}`;
  }

  private readString(value: ZonValue | undefined): string | null {
    return typeof value === "string" && value.trim() ? value : null;
  }

  private readHeight(value: ZonValue | undefined): number {
    return typeof value === "number" && Number.isFinite(value) && value > 0
      ? value
      : FALLBACK_HEIGHT;
  }

  private readTags(value: ZonValue | undefined): Set<string> {
    if (!Array.isArray(value)) {
      return new Set();
    }
    return new Set(
      value.filter((tag): tag is string => typeof tag === "string"),
    );
  }

  private registerAssetFile(
    type: EntityModelAssetType,
    filePath: string,
  ): string {
    const token = Buffer.from(`${type}:${filePath}`).toString("base64url");
    this.assetFiles.set(token, filePath);
    return token;
  }
}
