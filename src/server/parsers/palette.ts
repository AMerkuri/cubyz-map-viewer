/**
 * Palette parser for Cubyz save files.
 * Reads palette.zig.zon and biome_palette.zig.zon which are ZON arrays of strings.
 * Array index = numeric ID used in binary data.
 */

import { readFile } from "fs/promises";
import { parseZon, type ZonValue } from "./zon.js";

export interface Palette {
  /** index -> string ID */
  entries: string[];
  /** string ID -> index */
  nameToIndex: Map<string, number>;
}

export async function loadPalette(filePath: string): Promise<Palette> {
  const text = await readFile(filePath, "utf-8");
  const parsed = parseZon(text);

  const entries: string[] = [];
  const nameToIndex = new Map<string, number>();

  if (Array.isArray(parsed)) {
    for (let i = 0; i < parsed.length; i++) {
      const name = String(parsed[i]);
      entries.push(name);
      nameToIndex.set(name, i);
    }
  } else if (parsed && typeof parsed === "object") {
    // Legacy format: { "name": index }
    const obj = parsed as { [key: string]: ZonValue };
    for (const [name, index] of Object.entries(obj)) {
      const idx = Number(index);
      entries[idx] = name;
      nameToIndex.set(name, idx);
    }
  }

  return { entries, nameToIndex };
}
