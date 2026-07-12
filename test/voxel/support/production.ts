import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BlockColorTable } from "../../../src/server/services/block-color-table.js";
import type { BlockShapeTable } from "../../../src/server/services/block-shape-table.js";

const cacheRoot = await mkdtemp(join(tmpdir(), "cubyz-voxel-cache-"));
process.env.VOXEL_CACHE_DIR = cacheRoot;

const generator = await import(
  "../../../src/server/services/voxel-generator.js"
);
const summaries = await import(
  "../../../src/server/services/voxel-emitter-summary-service.js"
);

export const generateVoxelMesh = generator.generateVoxelMesh;
export const VoxelEmitterSummaryService = summaries.VoxelEmitterSummaryService;

type GeneratedLod1 = Awaited<ReturnType<typeof generator.generateVoxelMesh>> & {
  buffer: ArrayBuffer;
  stats: NonNullable<
    Awaited<ReturnType<typeof generator.generateVoxelMesh>>["stats"]
  >;
};

export async function cleanupVoxelCache(): Promise<void> {
  await rm(cacheRoot, { recursive: true, force: true });
}

export async function generateLod1(
  save: string,
  colors: BlockColorTable,
  shapes: BlockShapeTable,
  regionX = 0,
  regionY = 0,
): Promise<GeneratedLod1> {
  const result = await generateVoxelMesh(
    save,
    colors,
    shapes,
    1,
    regionX,
    regionY,
    { includeHaloEmitters: true },
  );
  if (!result.buffer || !result.stats) {
    throw new Error("fixture produced no voxel mesh metrics");
  }
  return result as GeneratedLod1;
}
