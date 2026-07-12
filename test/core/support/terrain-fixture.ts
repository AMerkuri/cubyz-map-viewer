import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";

const MAP_SIZE = 256;
const PIXEL_COUNT = MAP_SIZE * MAP_SIZE;

export async function writeAdjacentTerrainFixture(save: string): Promise<void> {
  for (let tileX = -1; tileX <= 2; tileX++) {
    for (let tileY = -1; tileY <= 1; tileY++) {
      await writeSurfaceTile(save, tileX, tileY);
    }
  }
}

export async function writeSurfaceTile(
  save: string,
  tileX: number,
  tileY: number,
  heightOffset = 0,
): Promise<void> {
  const data = Buffer.alloc(PIXEL_COUNT * 12);
  for (let x = 0; x < MAP_SIZE; x++) {
    for (let y = 0; y < MAP_SIZE; y++) {
      const index = x * MAP_SIZE + y;
      const worldX = tileX * MAP_SIZE + x;
      const worldY = tileY * MAP_SIZE + y;
      const height =
        Math.floor(worldX / 8) + Math.floor(worldY / 16) + heightOffset;
      data.writeInt32BE(height, PIXEL_COUNT * 4 + index * 4);
      data.writeInt32BE(height, PIXEL_COUNT * 8 + index * 4);
    }
  }
  const directory = join(save, "maps", "1", String(tileX * MAP_SIZE));
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, `${tileY * MAP_SIZE}.surface`),
    Buffer.concat([Buffer.from([1, 0]), deflateRawSync(data)]),
  );
}
