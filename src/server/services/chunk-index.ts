import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export interface ChunkIndexEntry {
  lod: number;
  regionX: number;
  regionY: number;
}

function isNodeErrorWithCode(
  error: unknown,
): error is NodeJS.ErrnoException & { code: string } {
  return error instanceof Error && "code" in error;
}

export async function buildChunkIndex(
  savePath: string,
): Promise<ChunkIndexEntry[]> {
  const chunksDir = join(savePath, "chunks");
  const index: ChunkIndexEntry[] = [];

  let lodDirs: string[];
  try {
    lodDirs = await readdir(chunksDir);
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT") {
      return index;
    }
    throw error;
  }

  for (const lodStr of lodDirs) {
    const lod = parseInt(lodStr, 10);
    if (Number.isNaN(lod) || lod <= 0) continue;

    const lodPath = join(chunksDir, lodStr);
    const lodStat = await stat(lodPath);
    if (!lodStat.isDirectory()) continue;

    const rxDirs = await readdir(lodPath);
    for (const rxStr of rxDirs) {
      const regionX = parseInt(rxStr, 10);
      if (Number.isNaN(regionX)) continue;

      const rxPath = join(lodPath, rxStr);
      const rxStat = await stat(rxPath);
      if (!rxStat.isDirectory()) continue;

      const ryDirs = await readdir(rxPath);
      for (const ryStr of ryDirs) {
        const regionY = parseInt(ryStr, 10);
        if (Number.isNaN(regionY)) continue;

        const ryPath = join(rxPath, ryStr);
        const ryStat = await stat(ryPath);
        if (!ryStat.isDirectory()) continue;

        const files = await readdir(ryPath);
        if (!files.some((file) => file.endsWith(".region"))) continue;

        index.push({ lod, regionX, regionY });
      }
    }
  }

  index.sort(
    (a, b) => a.lod - b.lod || a.regionX - b.regionX || a.regionY - b.regionY,
  );
  return index;
}
