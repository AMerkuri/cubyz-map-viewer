export const LOD_LEVELS = [1, 2, 4, 8, 16, 32];

export const LOD_BORDER_COLORS: Record<
  number,
  { line: number; label: string }
> = {
  1: { line: 0x44ff66, label: "#44ff66" },
  2: { line: 0x88ff44, label: "#88ff44" },
  4: { line: 0xffdd44, label: "#ffdd44" },
  8: { line: 0xffaa33, label: "#ffaa33" },
  16: { line: 0xff6633, label: "#ff6633" },
  32: { line: 0xff3344, label: "#ff3344" },
};

export const TERRAIN_LOD_DISTANCE_THRESHOLDS = [
  { maxDist: 600, lod: 1 },
  { maxDist: 1200, lod: 2 },
  { maxDist: 2400, lod: 4 },
  { maxDist: 4800, lod: 8 },
  { maxDist: 9600, lod: 16 },
  { maxDist: Infinity, lod: 32 },
];

export const VOXEL_REGION_CELLS = 128;
export const VOXEL_CHUNK_CELLS = 32;
export const TERRAIN_SKIRT_DEPTH = 32;
export const TERRAIN_UNDERLAY_OFFSET_Z = -6;
export const MAX_VOXEL_RETRIES = 2;
export const INITIAL_CAMERA_ZOOM = 500;
export const DEFAULT_START_OFFSET_Y = 400;
export const DEFAULT_START_OFFSET_Z = 300;
export const MAX_BIOME_LABELS = 120;
