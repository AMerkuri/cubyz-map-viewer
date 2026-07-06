import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { AssetNamespaceSource } from "../parsers/assets.js";
import type { Palette } from "../parsers/palette.js";
import { parseZon, type ZonValue } from "../parsers/zon.js";
import { logger } from "./logger.js";

export const VOXEL_POSITION_FIXED_SCALE = 4096;

export type BlockFallbackShapeKind = "cube" | "air";
export type SupportedBlockRotation =
  | "cubyz:no_rotation"
  | "cubyz:planar"
  | "cubyz:torch";
export type SupportedBlockSemantic =
  | "cubyz:stairs"
  | "cubyz:fence"
  | "cubyz:branch"
  | "cubyz:carpet"
  | "cubyz:sign"
  | "cubyz:hanging"
  | "cubyz:direction"
  | "cubyz:texture_pile";
type SupportedCubeBlockRotation = "cubyz:decayable" | "cubyz:log" | "cubyz:ore";

export interface BlockModelVertex {
  x: number;
  y: number;
  z: number;
}

export interface BlockModelQuad {
  vertices: [
    BlockModelVertex,
    BlockModelVertex,
    BlockModelVertex,
    BlockModelVertex,
  ];
  normal: BlockModelVertex;
}

export interface BlockCubeShape {
  kind: "cube";
  fallback: BlockFallbackShapeKind;
}

export interface BlockAirShape {
  kind: "air";
  fallback: BlockFallbackShapeKind;
}

export interface BlockModelShape {
  kind: "model";
  fallback: BlockFallbackShapeKind;
  blockId: string;
  modelRef: string;
  sideModelRef: string | null;
  rotation: SupportedBlockRotation;
  lodReplacement: number | null;
  quads: BlockModelQuad[];
  sideQuads: BlockModelQuad[];
  bounds: {
    min: BlockModelVertex;
    max: BlockModelVertex;
  };
}

export interface BlockSemanticShape {
  kind: "semantic";
  fallback: BlockFallbackShapeKind;
  blockId: string;
  semantic: SupportedBlockSemantic;
  lodReplacement: number | null;
  modelRefs: Record<string, string>;
  quads: BlockModelQuad[];
  variantQuads: Record<string, BlockModelQuad[]>;
  radius: number | null;
  states: number | null;
}

export type BlockShape =
  | BlockCubeShape
  | BlockAirShape
  | BlockModelShape
  | BlockSemanticShape;

export interface BlockShapeTable {
  shapes: BlockShape[];
  signature: string;
}

interface BlockDefinition {
  blockId: string;
  namespace: string;
  data: Record<string, ZonValue>;
  sourcePath: string;
  mtimeMs: number;
  size: number;
}

interface ResolvedModelAsset {
  path: string;
  mtimeMs: number;
  size: number;
}

interface ObjParseResult {
  quads: BlockModelQuad[];
  bounds: BlockModelShape["bounds"];
}

const BLOCK_DEFINITION_EXT = ".zig.zon";
const SUPPORTED_ROTATIONS = new Set<string>([
  "cubyz:no_rotation",
  "cubyz:planar",
  "cubyz:torch",
]);
const SUPPORTED_SEMANTICS = new Set<string>([
  "cubyz:stairs",
  "cubyz:fence",
  "cubyz:branch",
  "cubyz:carpet",
  "cubyz:sign",
  "cubyz:hanging",
  "cubyz:direction",
  "cubyz:texture_pile",
]);
const TEXTURE_PILE_MIN_STATES = 2;
const TEXTURE_PILE_MAX_STATES = 16;
const SUPPORTED_CUBE_ROTATIONS = new Set<string>([
  "cubyz:decayable",
  "cubyz:log",
  "cubyz:ore",
]);
const SHAPE_SEMANTIC_SIGNATURE_VERSION = "semantic-shapes-v2";
const EMPTY_BOUNDS = {
  min: { x: 0, y: 0, z: 0 },
  max: { x: 0, y: 0, z: 0 },
};
const reportedShapeDiagnostics = new Set<string>();

export async function buildBlockShapeTable(
  assetSources: readonly AssetNamespaceSource[],
  blockPalette: Palette,
): Promise<BlockShapeTable> {
  const definitions = await loadBlockDefinitions(assetSources);
  const shapes: BlockShape[] = [];
  const hash = createHash("sha1");
  hash.update(`block-shapes-v1|${SHAPE_SEMANTIC_SIGNATURE_VERSION}|`);

  for (
    let paletteIndex = 0;
    paletteIndex < blockPalette.entries.length;
    paletteIndex++
  ) {
    const blockId = blockPalette.entries[paletteIndex] ?? "";
    const definition = definitions.get(blockId);
    hash.update(`${paletteIndex}:${blockId}|`);

    if (isAirBlockId(blockId)) {
      shapes[paletteIndex] = { kind: "air", fallback: "air" };
      continue;
    }

    if (!definition) {
      shapes[paletteIndex] = { kind: "cube", fallback: "cube" };
      continue;
    }

    hash.update(`${definition.mtimeMs}:${definition.size}|`);
    const semantic = normalizeSemantic(definition.data.rotation);
    if (semantic) {
      const shape = await buildSemanticShape(
        assetSources,
        definition,
        semantic,
        blockPalette,
      );
      shapes[paletteIndex] = shape;
      hash.update(JSON.stringify(toSemanticSignatureInput(shape)));
      continue;
    }

    const cubeRotation = normalizeCubeRotation(definition.data.rotation);
    if (cubeRotation) {
      hash.update(`cube-rotation:${cubeRotation}|`);
      shapes[paletteIndex] = { kind: "cube", fallback: "cube" };
      continue;
    }

    const modelRefs = readModelRefs(
      definition.data.model,
      definition.namespace,
    );
    if (!modelRefs) {
      shapes[paletteIndex] = { kind: "cube", fallback: "cube" };
      continue;
    }

    if (modelRefs.base === "cubyz:cube" && modelRefs.side === null) {
      hash.update("cube-model:cubyz:cube|");
      shapes[paletteIndex] = { kind: "cube", fallback: "cube" };
      continue;
    }

    const rotation = normalizeRotation(definition.data.rotation);
    if (!rotation) {
      reportShapeDiagnostic("unsupported-rotation", blockId, {
        rotation: readString(definition.data.rotation),
      });
      shapes[paletteIndex] = { kind: "cube", fallback: "cube" };
      continue;
    }

    if (modelRefs.side && rotation !== "cubyz:torch") {
      reportShapeDiagnostic("unsupported-model-variants", blockId, {
        rotation,
      });
      shapes[paletteIndex] = { kind: "cube", fallback: "cube" };
      continue;
    }

    const model = await resolveModelAsset(assetSources, modelRefs.base);
    if (!model) {
      reportShapeDiagnostic("missing-model", blockId, {
        modelRef: modelRefs.base,
      });
      shapes[paletteIndex] = { kind: "cube", fallback: "cube" };
      continue;
    }

    const sideModel = modelRefs.side
      ? await resolveModelAsset(assetSources, modelRefs.side)
      : null;
    if (modelRefs.side && !sideModel) {
      reportShapeDiagnostic("missing-model", blockId, {
        modelRef: modelRefs.side,
      });
      shapes[paletteIndex] = { kind: "cube", fallback: "cube" };
      continue;
    }

    hash.update(`${model.path}:${model.mtimeMs}:${model.size}|`);
    if (sideModel) {
      hash.update(`${sideModel.path}:${sideModel.mtimeMs}:${sideModel.size}|`);
    }
    const parsedModel = await parseObjModel(model.path, blockId);
    if (!parsedModel || parsedModel.quads.length === 0) {
      reportShapeDiagnostic("unsupported-model", blockId, {
        modelRef: modelRefs.base,
      });
      shapes[paletteIndex] = { kind: "cube", fallback: "cube" };
      continue;
    }
    const parsedSideModel = sideModel
      ? await parseObjModel(sideModel.path, blockId)
      : null;
    if (sideModel && (!parsedSideModel || parsedSideModel.quads.length === 0)) {
      reportShapeDiagnostic("unsupported-model", blockId, {
        modelRef: modelRefs.side,
      });
      shapes[paletteIndex] = { kind: "cube", fallback: "cube" };
      continue;
    }

    shapes[paletteIndex] = {
      kind: "model",
      fallback: "cube",
      blockId,
      modelRef: modelRefs.base,
      sideModelRef: modelRefs.side,
      rotation,
      lodReplacement: resolveLodReplacementIndex(
        definition.data.lodReplacement,
        definition.namespace,
        blockPalette,
      ),
      quads: parsedModel.quads,
      sideQuads: parsedSideModel?.quads ?? [],
      bounds: parsedModel.bounds,
    };
  }

  return { shapes, signature: hash.digest("hex") };
}

export function resolveShapeForLod(
  table: BlockShapeTable,
  paletteIndex: number,
  lod: number,
): BlockShape {
  const shape = table.shapes[paletteIndex];
  if (!shape) return { kind: "cube", fallback: "cube" };
  if (lod === 1 || (shape.kind !== "model" && shape.kind !== "semantic"))
    return shape;
  if (shape.lodReplacement !== null) {
    return resolveShapeForLod(table, shape.lodReplacement, lod);
  }
  return shape.fallback === "air"
    ? { kind: "air", fallback: "air" }
    : { kind: "cube", fallback: "cube" };
}

async function loadBlockDefinitions(
  assetSources: readonly AssetNamespaceSource[],
): Promise<Map<string, BlockDefinition>> {
  const definitions = new Map<string, BlockDefinition>();
  for (const source of assetSources) {
    await scanBlockDefinitionDir(
      source,
      join(source.rootDir, "blocks"),
      "",
      {},
      definitions,
    );
  }
  return definitions;
}

async function scanBlockDefinitionDir(
  source: AssetNamespaceSource,
  baseDir: string,
  relativeDir: string,
  inheritedDefaults: Record<string, ZonValue>,
  out: Map<string, BlockDefinition>,
): Promise<void> {
  const dirPath = relativeDir ? join(baseDir, relativeDir) : baseDir;
  let entries: string[];
  try {
    entries = await readdir(dirPath);
  } catch {
    return;
  }

  let defaults = inheritedDefaults;
  if (entries.includes(`_defaults${BLOCK_DEFINITION_EXT}`)) {
    const defaultsPath = join(dirPath, `_defaults${BLOCK_DEFINITION_EXT}`);
    const parsed = await readZonObject(defaultsPath);
    if (parsed) {
      defaults = { ...inheritedDefaults, ...parsed };
    }
  }

  for (const entry of entries) {
    if (
      entry === "textures" ||
      entry === `_${"defaults"}${BLOCK_DEFINITION_EXT}`
    ) {
      continue;
    }
    const fullPath = join(dirPath, entry);
    let entryStat: Stats;
    try {
      entryStat = await stat(fullPath);
    } catch {
      continue;
    }

    const relativePath = relativeDir ? `${relativeDir}/${entry}` : entry;
    if (entryStat.isDirectory()) {
      await scanBlockDefinitionDir(
        source,
        baseDir,
        relativePath,
        defaults,
        out,
      );
      continue;
    }

    if (!entry.endsWith(BLOCK_DEFINITION_EXT)) continue;
    const parsed = await readZonObject(fullPath);
    if (!parsed) continue;
    const blockPath = relativePath.slice(0, -BLOCK_DEFINITION_EXT.length);
    const blockId = `${source.namespace}:${blockPath}`;
    out.set(blockId, {
      blockId,
      namespace: source.namespace,
      data: { ...defaults, ...parsed },
      sourcePath: fullPath,
      mtimeMs: Math.trunc(entryStat.mtimeMs),
      size: entryStat.size,
    });
  }
}

async function readZonObject(
  filePath: string,
): Promise<Record<string, ZonValue> | null> {
  try {
    const parsed = parseZon(await readFile(filePath, "utf-8"));
    return parsed && !Array.isArray(parsed) && typeof parsed === "object"
      ? (parsed as Record<string, ZonValue>)
      : null;
  } catch (error) {
    logger.warn("Skipping block shape definition", {
      filePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function resolveModelAsset(
  assetSources: readonly AssetNamespaceSource[],
  ref: string,
): Promise<ResolvedModelAsset | null> {
  const parsed = parseNamespacedRef(ref);
  if (!parsed) return null;
  const pathSegments = parsed.path.split("/").filter(Boolean);
  for (let index = assetSources.length - 1; index >= 0; index--) {
    const source = assetSources[index];
    if (!source || source.namespace !== parsed.namespace) continue;
    const basePath = join(source.rootDir, "models", ...pathSegments);
    const filePath = basePath.endsWith(".obj") ? basePath : `${basePath}.obj`;
    try {
      const stats = await stat(filePath);
      return {
        path: filePath,
        mtimeMs: Math.trunc(stats.mtimeMs),
        size: stats.size,
      };
    } catch {}
  }
  return null;
}

async function parseObjModel(
  filePath: string,
  blockId: string,
): Promise<ObjParseResult | null> {
  try {
    const text = await readFile(filePath, "utf-8");
    const vertices: BlockModelVertex[] = [];
    const normals: BlockModelVertex[] = [];
    const faces: { vertexIndices: number[]; normalIndex: number | null }[] = [];

    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const parts = line.split(/\s+/);
      const kind = parts[0];
      if (kind === "v") {
        vertices.push({
          x: Number(parts[1] ?? 0),
          y: Number(parts[2] ?? 0),
          z: Number(parts[3] ?? 0),
        });
        continue;
      }
      if (kind === "vn") {
        normals.push(
          normalizeVector({
            x: Number(parts[1] ?? 0),
            y: Number(parts[2] ?? 0),
            z: Number(parts[3] ?? 0),
          }),
        );
        continue;
      }
      if (kind === "f") {
        const vertexIndices: number[] = [];
        let normalIndex: number | null = null;
        for (const token of parts.slice(1)) {
          const [vRaw, _vtRaw, vnRaw] = token.split("/");
          const vertexIndex = resolveObjIndex(Number(vRaw), vertices.length);
          if (vertexIndex === null) continue;
          vertexIndices.push(vertexIndex);
          if (vnRaw) {
            normalIndex = resolveObjIndex(Number(vnRaw), normals.length);
          }
        }
        if (vertexIndices.length >= 3)
          faces.push({ vertexIndices, normalIndex });
      }
    }

    const scale = inferModelCoordinateScale(vertices);
    const normalizedVertices = vertices.map((vertex) => ({
      x: normalizeCoord(vertex.x, scale),
      y: normalizeCoord(vertex.y, scale),
      z: normalizeCoord(vertex.z, scale),
    }));
    const bounds = computeBounds(normalizedVertices);
    const quads: BlockModelQuad[] = [];
    for (const face of faces) {
      const faceVertices = face.vertexIndices
        .map((index) => normalizedVertices[index])
        .filter(Boolean);
      if (faceVertices.length < 3) continue;
      for (let index = 1; index < faceVertices.length - 1; index++) {
        const v0 = faceVertices[0];
        const v1 = faceVertices[index];
        const v2 = faceVertices[index + 1];
        if (!v0 || !v1 || !v2) continue;
        const v3 =
          faceVertices.length === 4 && index === 1 ? faceVertices[3] : v2;
        if (!v3) continue;
        quads.push({
          vertices: [v0, v1, v2, v3],
          normal:
            face.normalIndex !== null
              ? (normals[face.normalIndex] ?? computeNormal(v0, v1, v2))
              : computeNormal(v0, v1, v2),
        });
        if (faceVertices.length === 4) break;
      }
    }
    return { quads, bounds };
  } catch (error) {
    reportShapeDiagnostic("parse-model", blockId, {
      filePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function buildSemanticShape(
  assetSources: readonly AssetNamespaceSource[],
  definition: BlockDefinition,
  semantic: SupportedBlockSemantic,
  blockPalette: Palette,
): Promise<BlockSemanticShape> {
  const modelRefs =
    semantic === "cubyz:texture_pile"
      ? readTexturePileModelRefs(definition.data.model, definition.namespace)
      : readSemanticModelRefs(definition.data.model, definition.namespace);
  const states =
    semantic === "cubyz:texture_pile"
      ? readTexturePileStates(definition.data.model, definition.blockId)
      : null;
  const variantQuads: Record<string, BlockModelQuad[]> = {};
  const loadedRefs: Record<string, string> = {};

  for (const [variant, modelRef] of Object.entries(modelRefs)) {
    const model = await resolveModelAsset(assetSources, modelRef);
    if (!model) {
      reportShapeDiagnostic("missing-semantic-model", definition.blockId, {
        semantic,
        variant,
        modelRef,
      });
      continue;
    }
    const parsed = await parseObjModel(model.path, definition.blockId);
    if (!parsed || parsed.quads.length === 0) {
      reportShapeDiagnostic("unsupported-semantic-model", definition.blockId, {
        semantic,
        variant,
        modelRef,
      });
      continue;
    }
    loadedRefs[variant] = modelRef;
    variantQuads[variant] = parsed.quads;
  }

  if (
    requiresSemanticModel(semantic) &&
    Object.keys(variantQuads).length === 0
  ) {
    reportShapeDiagnostic("malformed-semantic-model", definition.blockId, {
      semantic,
    });
  }

  return {
    kind: "semantic",
    fallback: semantic === "cubyz:stairs" ? "cube" : "air",
    blockId: definition.blockId,
    semantic,
    lodReplacement: resolveLodReplacementIndex(
      definition.data.lodReplacement,
      definition.namespace,
      blockPalette,
    ),
    modelRefs: loadedRefs,
    quads: variantQuads.base ?? [],
    variantQuads,
    radius: readRadius(definition.data.model),
    states,
  };
}

function toSemanticSignatureInput(
  shape: BlockSemanticShape,
): Record<string, unknown> {
  return {
    blockId: shape.blockId,
    semantic: shape.semantic,
    lodReplacement: shape.lodReplacement,
    modelRefs: shape.modelRefs,
    radius: shape.radius,
    states: shape.states,
  };
}

function requiresSemanticModel(semantic: SupportedBlockSemantic): boolean {
  return (
    semantic === "cubyz:carpet" ||
    semantic === "cubyz:sign" ||
    semantic === "cubyz:hanging" ||
    semantic === "cubyz:direction" ||
    semantic === "cubyz:texture_pile"
  );
}

function resolveObjIndex(index: number, count: number): number | null {
  if (!Number.isInteger(index) || index === 0) return null;
  const resolved = index > 0 ? index - 1 : count + index;
  return resolved >= 0 && resolved < count ? resolved : null;
}

function inferModelCoordinateScale(vertices: BlockModelVertex[]): number {
  let maxAbs = 0;
  for (const vertex of vertices) {
    maxAbs = Math.max(
      maxAbs,
      Math.abs(vertex.x),
      Math.abs(vertex.y),
      Math.abs(vertex.z),
    );
  }
  return maxAbs > 1.5 ? 16 : 1;
}

function computeBounds(
  vertices: BlockModelVertex[],
): BlockModelShape["bounds"] {
  if (vertices.length === 0) return EMPTY_BOUNDS;
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const vertex of vertices) {
    min.x = Math.min(min.x, vertex.x);
    min.y = Math.min(min.y, vertex.y);
    min.z = Math.min(min.z, vertex.z);
    max.x = Math.max(max.x, vertex.x);
    max.y = Math.max(max.y, vertex.y);
    max.z = Math.max(max.z, vertex.z);
  }
  return { min, max };
}

function computeNormal(
  a: BlockModelVertex,
  b: BlockModelVertex,
  c: BlockModelVertex,
): BlockModelVertex {
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
  return normalizeVector({
    x: ab.y * ac.z - ab.z * ac.y,
    y: ab.z * ac.x - ab.x * ac.z,
    z: ab.x * ac.y - ab.y * ac.x,
  });
}

function normalizeVector(vector: BlockModelVertex): BlockModelVertex {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  return length > 0
    ? { x: vector.x / length, y: vector.y / length, z: vector.z / length }
    : { x: 0, y: 0, z: 1 };
}

function normalizeRotation(
  value: ZonValue | undefined,
): SupportedBlockRotation | null {
  const rotation = readString(value) ?? "cubyz:no_rotation";
  const normalized = rotation.includes(":") ? rotation : `cubyz:${rotation}`;
  return SUPPORTED_ROTATIONS.has(normalized)
    ? (normalized as SupportedBlockRotation)
    : null;
}

function normalizeSemantic(
  value: ZonValue | undefined,
): SupportedBlockSemantic | null {
  const rotation = readString(value) ?? "cubyz:no_rotation";
  const normalized = rotation.includes(":") ? rotation : `cubyz:${rotation}`;
  return SUPPORTED_SEMANTICS.has(normalized)
    ? (normalized as SupportedBlockSemantic)
    : null;
}

function normalizeCubeRotation(
  value: ZonValue | undefined,
): SupportedCubeBlockRotation | null {
  const rotation = readString(value) ?? "cubyz:no_rotation";
  const normalized = rotation.includes(":") ? rotation : `cubyz:${rotation}`;
  return SUPPORTED_CUBE_ROTATIONS.has(normalized)
    ? (normalized as SupportedCubeBlockRotation)
    : null;
}

function resolveLodReplacementIndex(
  value: ZonValue | undefined,
  fallbackNamespace: string,
  palette: Palette,
): number | null {
  const ref = readAssetRef(value, fallbackNamespace);
  if (!ref) return null;
  return palette.nameToIndex.get(ref) ?? null;
}

function readAssetRef(
  value: ZonValue | undefined,
  fallbackNamespace: string,
): string | null {
  const ref = readString(value);
  if (!ref) return null;
  return ref.includes(":") ? ref : `${fallbackNamespace}:${ref}`;
}

function readModelRefs(
  value: ZonValue | undefined,
  fallbackNamespace: string,
): { base: string; side: string | null } | null {
  const stringRef = readAssetRef(value, fallbackNamespace);
  if (stringRef) return { base: stringRef, side: null };
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const object = value as Record<string, ZonValue>;
  const base = readAssetRef(object.base, fallbackNamespace);
  if (!base) return null;
  return {
    base,
    side: readAssetRef(object.side, fallbackNamespace),
  };
}

function readSemanticModelRefs(
  value: ZonValue | undefined,
  fallbackNamespace: string,
): Record<string, string> {
  const stringRef = readAssetRef(value, fallbackNamespace);
  if (stringRef) return { base: stringRef };
  if (!value || Array.isArray(value) || typeof value !== "object") return {};
  const object = value as Record<string, ZonValue>;
  const refs: Record<string, string> = {};
  for (const key of ["base", "floor", "ceiling", "side", "top", "bottom"]) {
    const ref = readAssetRef(object[key], fallbackNamespace);
    if (ref) refs[key] = ref;
  }
  return refs;
}

function readTexturePileModelRefs(
  value: ZonValue | undefined,
  fallbackNamespace: string,
): Record<string, string> {
  if (!value || Array.isArray(value) || typeof value !== "object") return {};
  const object = value as Record<string, ZonValue>;
  const base = readAssetRef(object.model, fallbackNamespace);
  return base ? { base } : {};
}

function readTexturePileStates(
  value: ZonValue | undefined,
  blockId: string,
): number | null {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const states = (value as Record<string, ZonValue>).states;
  if (typeof states !== "number" || !Number.isFinite(states)) return null;
  const rounded = Math.trunc(states);
  if (rounded < TEXTURE_PILE_MIN_STATES || rounded > TEXTURE_PILE_MAX_STATES) {
    reportShapeDiagnostic("texture-pile-state-count", blockId, {
      states: rounded,
      min: TEXTURE_PILE_MIN_STATES,
      max: TEXTURE_PILE_MAX_STATES,
    });
  }
  return Math.max(
    TEXTURE_PILE_MIN_STATES,
    Math.min(TEXTURE_PILE_MAX_STATES, rounded),
  );
}

function readRadius(value: ZonValue | undefined): number | null {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const radius = (value as Record<string, ZonValue>).radius;
  return typeof radius === "number" && Number.isFinite(radius) ? radius : null;
}

function readString(value: ZonValue | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseNamespacedRef(
  ref: string,
): { namespace: string; path: string } | null {
  const separator = ref.indexOf(":");
  if (separator <= 0 || separator === ref.length - 1) return null;
  const namespace = ref.slice(0, separator);
  const path = ref.slice(separator + 1);
  if (!/^[A-Za-z0-9._-]+$/.test(namespace) || path.includes("..")) return null;
  if (!/^[A-Za-z0-9._/-]+$/.test(path)) return null;
  return { namespace, path };
}

function isAirBlockId(blockId: string): boolean {
  return blockId === "cubyz:air" || blockId.endsWith(":air");
}

function normalizeCoord(value: number, scale: number): number {
  const normalized = value / scale;
  return Number.isFinite(normalized) ? normalized : 0;
}

function reportShapeDiagnostic(
  reason: string,
  blockId: string,
  details: Record<string, unknown>,
): void {
  const key = `${reason}:${blockId}`;
  if (reportedShapeDiagnostics.has(key)) return;
  reportedShapeDiagnostics.add(key);
  logger.warn("Using fallback block shape", { blockId, reason, ...details });
}
