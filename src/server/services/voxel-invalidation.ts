export const SUPPORTED_VOXEL_LODS = [1, 2, 4, 8, 16, 32] as const;

export type SupportedVoxelLod = (typeof SUPPORTED_VOXEL_LODS)[number];

export interface VoxelInvalidationRegion {
  lod: SupportedVoxelLod;
  regionX: number;
  regionY: number;
}

const VOXEL_REGION_CELLS = 128;
export const LOD1_EMITTER_INFLUENCE_RADIUS_WORLD = 12;
export const COARSE_EMITTER_INFLUENCE_RADIUS_WORLD = 28;

export function isSupportedVoxelLod(lod: number): lod is SupportedVoxelLod {
  return SUPPORTED_VOXEL_LODS.includes(lod as SupportedVoxelLod);
}

export function voxelInvalidationRegionKey(
  region: VoxelInvalidationRegion,
): string {
  return `${region.lod}/${region.regionX}/${region.regionY}`;
}

export function deduplicateVoxelInvalidationSources(
  sources: Iterable<VoxelInvalidationRegion>,
): VoxelInvalidationRegion[] {
  const unique = new Map<string, VoxelInvalidationRegion>();
  for (const source of sources) {
    const span = VOXEL_REGION_CELLS * source.lod;
    const aligned = {
      lod: source.lod,
      regionX: Math.floor(source.regionX / span) * span,
      regionY: Math.floor(source.regionY / span) * span,
    };
    unique.set(voxelInvalidationRegionKey(aligned), aligned);
  }
  return [...unique.values()];
}

export function expandVoxelInvalidationBatch(
  sources: Iterable<VoxelInvalidationRegion>,
): VoxelInvalidationRegion[] {
  const affected = new Map<string, VoxelInvalidationRegion>();
  for (const source of deduplicateVoxelInvalidationSources(sources)) {
    for (const region of expandVoxelInvalidationFootprint(source)) {
      affected.set(voxelInvalidationRegionKey(region), region);
    }
  }
  return [...affected.values()];
}

export function expandVoxelInvalidationFootprint(
  source: VoxelInvalidationRegion,
): VoxelInvalidationRegion[] {
  const span = VOXEL_REGION_CELLS * source.lod;
  const radius =
    source.lod === 1
      ? LOD1_EMITTER_INFLUENCE_RADIUS_WORLD
      : COARSE_EMITTER_INFLUENCE_RADIUS_WORLD;
  const sourceX = Math.floor(source.regionX / span) * span;
  const sourceY = Math.floor(source.regionY / span) * span;
  const startX = Math.floor((sourceX - radius) / span) * span;
  const endX = Math.floor((sourceX + span - 1 + radius) / span) * span;
  const startY = Math.floor((sourceY - radius) / span) * span;
  const endY = Math.floor((sourceY + span - 1 + radius) / span) * span;
  const affected = new Map<string, VoxelInvalidationRegion>();

  for (let regionX = startX; regionX <= endX; regionX += span) {
    for (let regionY = startY; regionY <= endY; regionY += span) {
      const region = { lod: source.lod, regionX, regionY };
      affected.set(voxelInvalidationRegionKey(region), region);

      if (source.lod !== 1) continue;
      for (const ancestorLod of SUPPORTED_VOXEL_LODS.slice(1)) {
        const ancestorSpan = VOXEL_REGION_CELLS * ancestorLod;
        const ancestor = {
          lod: ancestorLod,
          regionX: Math.floor(regionX / ancestorSpan) * ancestorSpan,
          regionY: Math.floor(regionY / ancestorSpan) * ancestorSpan,
        };
        affected.set(voxelInvalidationRegionKey(ancestor), ancestor);
      }
    }
  }

  return [...affected.values()];
}
