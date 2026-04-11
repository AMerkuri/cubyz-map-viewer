import type { ColorMapService } from "./color-map.js";

export interface BlockColorTable {
  rgb: Uint8Array;
}

export function buildBlockColorTable(
  colorMap: ColorMapService,
  size: number = 65536,
): BlockColorTable {
  const rgb = new Uint8Array(size * 3);
  for (let i = 0; i < size; i++) {
    const color = colorMap.getBlockColor(i);
    const off = i * 3;
    rgb[off] = color.r;
    rgb[off + 1] = color.g;
    rgb[off + 2] = color.b;
  }
  return { rgb };
}
