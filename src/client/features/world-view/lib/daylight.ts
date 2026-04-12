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
