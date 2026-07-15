import { existsSync } from "node:fs";

import { parseRegionFile, type RegionData } from "../parsers/region.js";

type VoxelRegionLoadResult =
  | { status: "missing"; region: null }
  | { status: "parsed"; region: RegionData }
  | { status: "error"; region: null; error: unknown };

export async function loadVoxelRegionFile(
  path: string,
  worldX: number,
  worldY: number,
  worldZ: number,
  lod: number,
): Promise<VoxelRegionLoadResult> {
  if (!existsSync(path)) return { status: "missing", region: null };
  try {
    return {
      status: "parsed",
      region: await parseRegionFile(path, worldX, worldY, worldZ, lod),
    };
  } catch (error) {
    return { status: "error", region: null, error };
  }
}
