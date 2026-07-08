/**
 * Player avatar model resolution from Cubyz player save data.
 *
 * Cubyz persists a player's selected avatar as the `cubyz:model` entity
 * component inside `players/<index>.zon` under `entity.components`. The value is
 * URL-safe base64-encoded binary component data produced by
 * `main.entity.server.componentsToBase64`. Each component in the stream is
 * encoded as:
 *   - component ID       (varint u32, index into entity_component_palette)
 *   - component version  (varint u32)
 *   - component data     (varint length + raw bytes)
 * The `cubyz:model` component payload is a single varint holding an
 * entity-model palette index, which resolves through entity_model_palette to a
 * model ID such as `cubyz:cubert`.
 *
 * Resolution is deliberately conservative: any decode/lookup failure falls
 * back to the default avatar `cubyz:snale`. The resolver returns any
 * palette-resolved model ID verbatim; whether a given ID renders as a player
 * marker is decided downstream by the manifest service (descriptor tags) and
 * the client (asset availability).
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseZon } from "./zon.js";

const DEFAULT_AVATAR_MODEL_ID = "cubyz:snale";

const MODEL_COMPONENT_ID = "cubyz:model";
const ENTITY_COMPONENT_PALETTE_FILE = "entity_component_palette.zig.zon";
const ENTITY_MODEL_PALETTE_FILE = "entity_model_palette.zig.zon";

interface DecodedComponent {
  componentId: number;
  version: number;
  data: Uint8Array;
}

/**
 * Minimal little-endian reader matching Cubyz varint and sized-slice encoding.
 */
class ComponentBinaryReader {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  readByte(): number {
    if (this.offset >= this.bytes.length) {
      throw new Error("Component reader out of bounds");
    }
    const value = this.bytes[this.offset];
    this.offset += 1;
    return value;
  }

  /** LEB128-style unsigned varint (matches Cubyz BinaryReader.readVarInt). */
  readVarInt(): number {
    let result = 0;
    let shift = 0;
    while (true) {
      const nextByte = this.readByte();
      result += (nextByte & 0x7f) * 2 ** shift;
      if ((nextByte & 0x80) === 0) {
        break;
      }
      shift += 7;
      if (shift > 49) {
        throw new Error("Component varint too large");
      }
    }
    if (!Number.isSafeInteger(result)) {
      throw new Error("Component varint exceeds safe integer range");
    }
    return result;
  }

  readSliceWithSize(): Uint8Array {
    const length = this.readVarInt();
    if (length > this.remaining) {
      throw new Error("Component slice out of bounds");
    }
    const slice = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }
}

function decodeUrlSafeBase64(value: string): Uint8Array {
  // Node's base64 decoder accepts URL-safe input via the "base64url" encoding.
  return new Uint8Array(Buffer.from(value, "base64url"));
}

function decodeComponents(base64Data: string): DecodedComponent[] {
  const bytes = decodeUrlSafeBase64(base64Data);
  const reader = new ComponentBinaryReader(bytes);
  const components: DecodedComponent[] = [];
  while (reader.remaining > 0) {
    const componentId = reader.readVarInt();
    const version = reader.readVarInt();
    const data = reader.readSliceWithSize();
    components.push({ componentId, version, data });
  }
  return components;
}

/**
 * Palettes cache keyed by save path. Palettes rarely change and reloading them
 * for every player file would multiply disk reads on `/api/players`.
 */
export interface EntityPalettes {
  /** Index of `cubyz:model` in the entity component palette, or null. */
  modelComponentIndex: number | null;
  /** Entity model palette: index -> model ID string. */
  modelPaletteEntries: string[];
}

async function loadPaletteArray(filePath: string): Promise<string[]> {
  const text = await readFile(filePath, "utf-8");
  const parsed = parseZon(text);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.map((entry) => String(entry));
}

export async function loadEntityPalettes(
  savePath: string,
): Promise<EntityPalettes> {
  const [componentEntries, modelPaletteEntries] = await Promise.all([
    loadPaletteArray(join(savePath, ENTITY_COMPONENT_PALETTE_FILE)).catch(
      () => [] as string[],
    ),
    loadPaletteArray(join(savePath, ENTITY_MODEL_PALETTE_FILE)).catch(
      () => [] as string[],
    ),
  ]);

  const modelComponentIndex = componentEntries.indexOf(MODEL_COMPONENT_ID);
  return {
    modelComponentIndex: modelComponentIndex >= 0 ? modelComponentIndex : null,
    modelPaletteEntries,
  };
}

/**
 * Resolve a player avatar model ID from encoded player component data.
 *
 * Returns `cubyz:snale` when the component data is missing, malformed, the
 * palettes are unavailable, or the palette index is out of range. Any other
 * palette-resolved model ID is returned verbatim so the manifest service and
 * client can decide availability.
 */
export function resolveAvatarModelId(
  componentsBase64: string | null | undefined,
  palettes: EntityPalettes,
): string {
  if (!componentsBase64 || palettes.modelComponentIndex === null) {
    return DEFAULT_AVATAR_MODEL_ID;
  }

  let components: DecodedComponent[];
  try {
    components = decodeComponents(componentsBase64);
  } catch {
    return DEFAULT_AVATAR_MODEL_ID;
  }

  const modelComponent = components.find(
    (component) => component.componentId === palettes.modelComponentIndex,
  );
  if (!modelComponent) {
    return DEFAULT_AVATAR_MODEL_ID;
  }

  let modelPaletteIndex: number;
  try {
    modelPaletteIndex = new ComponentBinaryReader(
      modelComponent.data,
    ).readVarInt();
  } catch {
    return DEFAULT_AVATAR_MODEL_ID;
  }

  const modelId = palettes.modelPaletteEntries[modelPaletteIndex];
  if (typeof modelId !== "string") {
    return DEFAULT_AVATAR_MODEL_ID;
  }

  return modelId;
}
