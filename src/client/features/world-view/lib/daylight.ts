export const DAYLIGHT_MAIN_SUN_POSITION = {
  x: 140,
  y: -90,
  z: 300,
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

// Mesh-local emitted-light contribution baked by the voxel worker from
// payload-owned own-region plus halo LOD 1 emitter records. The values are
// stylized for Cubyz-like voxel readability, not physical falloff: light
// spreads over a bounded radius, wraps softly around faces, and is clamped per
// channel so nearby surfaces keep their block hue instead of washing to white.
export const VOXEL_EMITTED_LIGHT = {
  // World-space radius (blocks at LOD 1) beyond which an emitter contributes
  // nothing. Also the spatial-grid cell size used to prefilter emitters.
  radius: 12,
  // Overall multiplier applied to each emitter's normalized RGB contribution.
  intensity: 0.5,
  // Per-channel clamp for the accumulated light factor so stacked emitters
  // brighten deterministically without unbounded additive blowout.
  maxContribution: 0.66,
  // 0..1 directional wrap: 1 ignores face orientation entirely, 0 is a pure
  // lambert term. High wrap keeps emitter-adjacent faces readable.
  directionalWrap: 0.5,
  // Deterministic cap on emitter candidates evaluated per vertex.
  maxCandidatesPerVertex: 32,
} as const;
