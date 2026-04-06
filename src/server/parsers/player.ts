/**
 * Player data parser for players/*.zon files.
 */

import { readFile, readdir } from "fs/promises";
import { join } from "path";
import { parseZon, type ZonValue } from "./zon.js";

export interface PlayerData {
  name: string;
  position: [number, number, number];
  rotation: [number, number, number];
  gamemode: string;
  health: number;
  energy: number;
  spawnPos: [number, number, number];
}

export async function parsePlayerFile(filePath: string): Promise<PlayerData> {
  const text = await readFile(filePath, "utf-8");
  const parsed = parseZon(text) as Record<string, ZonValue>;

  const entity = (parsed.entity ?? {}) as Record<string, ZonValue>;
  const pos = (entity.position ?? [0, 0, 0]) as number[];
  const rot = (entity.rotation ?? [0, 0, 0]) as number[];
  const spawnPos = (parsed.playerSpawnPos ?? [0, 0, 0]) as number[];

  return {
    name: String(parsed.name ?? "Unknown"),
    position: [pos[0] ?? 0, pos[1] ?? 0, pos[2] ?? 0],
    rotation: [rot[0] ?? 0, rot[1] ?? 0, rot[2] ?? 0],
    gamemode: String(parsed.gamemode ?? "creative"),
    health: Number(entity.health ?? 0),
    energy: Number(entity.energy ?? 0),
    spawnPos: [spawnPos[0] ?? 0, spawnPos[1] ?? 0, spawnPos[2] ?? 0],
  };
}

export async function loadAllPlayers(
  playersDir: string
): Promise<PlayerData[]> {
  try {
    const files = await readdir(playersDir);
    const zonFiles = files
      .filter((f) => f.endsWith(".zon"))
      .sort((a, b) => {
        const numA = parseInt(a);
        const numB = parseInt(b);
        return numA - numB;
      });

    const players: PlayerData[] = [];
    for (const file of zonFiles) {
      try {
        const player = await parsePlayerFile(join(playersDir, file));
        players.push(player);
      } catch (e) {
        console.warn(`Failed to parse player file ${file}: ${e}`);
      }
    }
    return players;
  } catch {
    return [];
  }
}
