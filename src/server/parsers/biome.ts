/**
 * Biome definition parser.
 * Reads biome .zig.zon files from the assets directory to extract
 * ground_structure (top block for color mapping).
 */

import { readFile, readdir, stat } from "fs/promises";
import { join, basename } from "path";
import { parseZon, type ZonValue } from "./zon.js";

export interface BiomeDefinition {
  id: string;
  /** The top block of the ground structure (e.g. "cubyz:grass") */
  topBlock: string | null;
  /** Full ground structure array */
  groundStructure: string[];
}

/**
 * Parse ground_structure entry like "cubyz:grass" or "2 to 3 cubyz:soil"
 * Returns just the block ID part.
 */
function parseGroundEntry(entry: string): string {
  // Format: "cubyz:block" or "N cubyz:block" or "N to M cubyz:block"
  const parts = entry.split(" ");
  // The block ID is always the last part
  return parts[parts.length - 1];
}

export async function parseBiomeFile(
  filePath: string,
  biomeId: string
): Promise<BiomeDefinition> {
  const text = await readFile(filePath, "utf-8");
  const parsed = parseZon(text) as Record<string, ZonValue>;

  const groundStructure: string[] = [];
  const gs = parsed.ground_structure;
  if (Array.isArray(gs)) {
    for (const entry of gs) {
      groundStructure.push(String(entry));
    }
  }

  const topBlock =
    groundStructure.length > 0
      ? parseGroundEntry(groundStructure[0])
      : null;

  return { id: biomeId, topBlock, groundStructure };
}

/**
 * Recursively discover and parse all biome definitions in the assets dir.
 * Biomes can be in subdirectories (e.g., assets/cubyz/biomes/cave/cave.zig.zon)
 */
export async function loadAllBiomes(
  biomesDir: string,
  prefix: string = "cubyz"
): Promise<Map<string, BiomeDefinition>> {
  const biomes = new Map<string, BiomeDefinition>();
  await scanBiomeDir(biomesDir, prefix, "", biomes);
  return biomes;
}

async function scanBiomeDir(
  baseDir: string,
  prefix: string,
  subPath: string,
  biomes: Map<string, BiomeDefinition>
): Promise<void> {
  const dirPath = subPath ? join(baseDir, subPath) : baseDir;
  let entries: string[];
  try {
    entries = await readdir(dirPath);
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dirPath, entry);
    const st = await stat(fullPath);

    if (st.isDirectory()) {
      const nextSub = subPath ? `${subPath}/${entry}` : entry;
      await scanBiomeDir(baseDir, prefix, nextSub, biomes);
    } else if (entry.endsWith(".zig.zon")) {
      const name = basename(entry, ".zig.zon");
      const biomePath = subPath ? `${subPath}/${name}` : name;
      const biomeId = `${prefix}:${biomePath}`;
      try {
        const biome = await parseBiomeFile(fullPath, biomeId);
        biomes.set(biomeId, biome);
      } catch (e) {
        console.warn(`Failed to parse biome ${biomeId}: ${e}`);
      }
    }
  }
}
