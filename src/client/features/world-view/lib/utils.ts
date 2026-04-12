import { VOXEL_CHUNK_CELLS, VOXEL_REGION_CELLS } from "./constants.js";

export function worldToScene(
  worldX: number,
  worldY: number,
  worldZ: number,
): [number, number, number] {
  return [worldX, worldY, worldZ];
}

export function shouldRenderTerrainForMode(
  mode: "terrain" | "voxel",
  showTerrain: boolean,
  showVoxelTerrain: boolean,
): boolean {
  return mode === "terrain" ? showTerrain : showVoxelTerrain;
}

export function regionWorldSize(lod: number): number {
  return VOXEL_REGION_CELLS * lod;
}

export function chunkWorldSize(lod: number): number {
  return VOXEL_CHUNK_CELLS * lod;
}

export function formatHeight(value: number): string {
  if (!Number.isFinite(value)) return "n/a";
  return value.toFixed(1);
}

export function countBits16(v: number): number {
  let n = v & 0xffff;
  let c = 0;
  while (n) {
    n &= n - 1;
    c++;
  }
  return c;
}

export function isVoxelTileComplete(chunkCoverage: number): boolean {
  return (chunkCoverage & 0xffff) === 0xffff;
}

export function formatBiomeName(biomeId: string): string {
  const name = biomeId.includes(":") ? biomeId.split(":")[1] : biomeId;
  const parts = name.split(/[/_]/).filter(Boolean);
  return parts
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .reverse()
    .join(" ");
}

export function cleanPlayerName(name: string): string {
  return name.replace(/[*]{1,3}|#[0-9A-Fa-f]{6}/g, "").trim() || "Player";
}

export interface FormattedPlayerNameSegment {
  text: string;
  color: string | null;
}

export function parseFormattedPlayerName(
  name: string,
): FormattedPlayerNameSegment[] {
  const segments: FormattedPlayerNameSegment[] = [];
  const source = name.replace(/[*]{1,3}/g, "");
  let activeColor: string | null = null;
  let buffer = "";

  function flush() {
    if (!buffer) return;
    segments.push({ text: buffer, color: activeColor });
    buffer = "";
  }

  for (let i = 0; i < source.length; ) {
    if (source[i] === "#") {
      const candidate = source.slice(i + 1, i + 7);
      if (/^[0-9A-Fa-f]{6}$/.test(candidate)) {
        flush();
        activeColor = `#${candidate}`;
        i += 7;
        continue;
      }
    }
    buffer += source[i] ?? "";
    i += 1;
  }

  flush();

  return segments.length > 0
    ? segments
    : [{ text: cleanPlayerName(name), color: null }];
}

export function parseVoxelKey(
  key: string,
): { lod: number; regionX: number; regionY: number } | null {
  const parts = key.split("/");
  if (parts.length !== 3) return null;
  const lod = parseInt(parts[0] ?? "", 10);
  const regionX = parseInt(parts[1] ?? "", 10);
  const regionY = parseInt(parts[2] ?? "", 10);
  if (
    !Number.isFinite(lod) ||
    !Number.isFinite(regionX) ||
    !Number.isFinite(regionY)
  )
    return null;
  return { lod, regionX, regionY };
}

export function voxelQuadrantBit(quadrant: number): number {
  return 1 << quadrant;
}
