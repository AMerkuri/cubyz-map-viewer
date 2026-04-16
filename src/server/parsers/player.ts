/**
 * Player data parser for players/*.zon files.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { parseZon, type ZonValue } from "./zon.js";

export const DEFAULT_PLAYER_ACTIVE_WINDOW_MS = 60 * 1000;
export const DEFAULT_PLAYER_RETENTION_MS = 60 * 5 * 1000;

export interface PlayerLoadOptions {
  activeWindowMs?: number;
  retentionMs?: number;
  now?: number;
}

export interface PlayerData {
  name: string;
  position: [number, number, number];
  rotation: [number, number, number];
  health: number;
  energy: number;
  spawnPos: [number, number, number];
  /** Unix timestamp (ms) of the last save file modification */
  lastSeen: number;
  /** True when the file was modified within the configured active window. */
  isActive: boolean;
}

export async function parsePlayerFile(
  filePath: string,
  options: PlayerLoadOptions = {},
): Promise<PlayerData> {
  const [text, fileStat] = await Promise.all([
    readFile(filePath, "utf-8"),
    stat(filePath),
  ]);
  const parsed = parseZon(text) as Record<string, ZonValue>;

  const entity = (parsed.entity ?? {}) as Record<string, ZonValue>;
  const pos = (entity.position ?? [0, 0, 0]) as number[];
  const rot = (entity.rotation ?? [0, 0, 0]) as number[];
  const spawnPos = (parsed.playerSpawnPos ?? [0, 0, 0]) as number[];

  const lastSeen = fileStat.mtimeMs;
  const now = options.now ?? Date.now();
  const activeWindowMs =
    options.activeWindowMs ?? DEFAULT_PLAYER_ACTIVE_WINDOW_MS;
  const isActive = now - lastSeen <= activeWindowMs;

  return {
    name: String(parsed.name ?? "Unknown"),
    position: [pos[0] ?? 0, pos[1] ?? 0, pos[2] ?? 0],
    rotation: [rot[0] ?? 0, rot[1] ?? 0, rot[2] ?? 0],
    health: Number(entity.health ?? 0),
    energy: Number(entity.energy ?? 0),
    spawnPos: [spawnPos[0] ?? 0, spawnPos[1] ?? 0, spawnPos[2] ?? 0],
    lastSeen,
    isActive,
  };
}

export async function loadAllPlayers(
  playersDir: string,
  options: PlayerLoadOptions = {},
): Promise<PlayerData[]> {
  try {
    const now = options.now ?? Date.now();
    const retentionMs = options.retentionMs ?? DEFAULT_PLAYER_RETENTION_MS;
    const files = await readdir(playersDir);
    const zonFiles = files
      .filter((f) => f.endsWith(".zon"))
      .sort((a, b) => {
        const numA = parseInt(a, 10);
        const numB = parseInt(b, 10);
        return numA - numB;
      });

    const players: PlayerData[] = [];
    for (const file of zonFiles) {
      try {
        const player = await parsePlayerFile(join(playersDir, file), {
          ...options,
          now,
        });
        if (now - player.lastSeen <= retentionMs) {
          players.push(player);
        }
      } catch (e) {
        console.warn(`Failed to parse player file ${file}: ${e}`);
      }
    }
    return players;
  } catch {
    return [];
  }
}
