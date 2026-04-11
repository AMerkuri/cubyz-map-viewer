/**
 * World metadata parser for world.zig.zon files.
 */

import { readFile } from "node:fs/promises";
import { parseZon, type ZonValue } from "./zon.js";

export interface WorldMetadata {
  name: string;
  version: number;
  seed: number;
  spawn: [number, number, number];
  gameTime: number;
  doGameTimeCycle: boolean;
  tickSpeed: number;
  defaultGamemode: string;
  allowCheats: boolean;
  lastUsedTime: number;
}

function getField(obj: Record<string, ZonValue>, key: string): ZonValue {
  return obj[key] ?? null;
}

export async function parseWorldMeta(filePath: string): Promise<WorldMetadata> {
  const text = await readFile(filePath, "utf-8");
  const parsed = parseZon(text) as Record<string, ZonValue>;

  const settings = (parsed.settings ?? {}) as Record<string, ZonValue>;
  const spawnArr = (parsed.spawn ?? [0, 0, 0]) as number[];

  return {
    name: String(getField(parsed, "name") ?? "Unknown"),
    version: Number(getField(parsed, "version") ?? 0),
    seed: Number(settings.seed ?? 0),
    spawn: [spawnArr[0] ?? 0, spawnArr[1] ?? 0, spawnArr[2] ?? 0],
    gameTime: Number(getField(parsed, "gameTime") ?? 0),
    doGameTimeCycle: Boolean(getField(parsed, "doGameTimeCycle") ?? true),
    tickSpeed: Number(getField(parsed, "tickSpeed") ?? 12),
    defaultGamemode: String(settings.defaultGamemode ?? "creative"),
    allowCheats: Boolean(settings.allowCheats ?? false),
    lastUsedTime: Number(getField(parsed, "lastUsedTime") ?? 0),
  };
}
