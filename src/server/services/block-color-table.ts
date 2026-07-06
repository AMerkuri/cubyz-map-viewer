import type { ColorMapService } from "./color-map.js";

export interface BlockColorTable {
  rgb: Uint8Array;
  airLike: Uint8Array;
  renderKind: Uint8Array;
  transparentBackface: Uint8Array;
  transparentGroup: Uint32Array;
}

export function buildBlockColorTable(
  colorMap: ColorMapService,
  size: number = 65536,
): BlockColorTable {
  const rgb = new Uint8Array(size * 3);
  const airLike = new Uint8Array(size);
  const renderKind = new Uint8Array(size);
  const transparentBackface = new Uint8Array(size);
  const transparentGroup = new Uint32Array(size);
  for (let i = 0; i < size; i++) {
    const color = colorMap.getBlockColor(i);
    const off = i * 3;
    rgb[off] = color.r;
    rgb[off + 1] = color.g;
    rgb[off + 2] = color.b;
    airLike[i] = colorMap.isBlockPaletteIndexAirLike(i) ? 1 : 0;
    renderKind[i] = colorMap.getBlockPaletteRenderKind(i);
    transparentBackface[i] = colorMap.blockPaletteIndexHasTransparentBackFace(i)
      ? 1
      : 0;
    transparentGroup[i] = colorMap.getBlockPaletteTransparentGroup(i);
  }
  return { rgb, airLike, renderKind, transparentBackface, transparentGroup };
}
