export const DAYLIGHT_MAIN_SUN_POSITION = {
  x: 140,
  y: -90,
  z: 300,
} as const;

export const DAYLIGHT_FILL_POSITION = {
  x: -90,
  y: 70,
  z: 180,
} as const;

// FOR DEBUGGING
// export const VOXEL_FACE_SHADING = {
//   base: 1,
//   sunStrength: 0,
//   upStrength: 0,
//   maxShade: 1,
//   topWarmTint: {
//     r: 1,
//     g: 1,
//     b: 1,
//   },
// } as const;

export const VOXEL_FACE_SHADING = {
  base: 0.76,
  sunStrength: 0.16,
  upStrength: 0.12,
  maxShade: 1.02,
  topWarmTint: {
    r: 1.02,
    g: 1.01,
    b: 0.98,
  },
} as const;

export const VOXEL_DEPTH_CUE = {
  sideBottom: 1,
  sideTop: 1,
} as const;

export const VOXEL_TOP_AO = {
  enabledLods: [1, 2],
  minShade: 0.78,
  seamMinShade: 0.92,
  seamBlendCells: 3,
} as const;

export const VOXEL_WALL_AO = {
  enabledLods: [1, 2],
  minShade: 0.84,
} as const;
