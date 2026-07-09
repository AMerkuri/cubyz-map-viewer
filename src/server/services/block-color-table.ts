import type { ColorMapService } from "./color-map.js";

export interface BlockColorTable {
  rgb: Uint8Array;
  emittedLightRgb: Uint8Array;
  airLike: Uint8Array;
  renderKind: Uint8Array;
  transparentBackface: Uint8Array;
  transparentGroup: Uint32Array;
  signature: string;
}

export function buildBlockColorTable(
  colorMap: ColorMapService,
  size: number = 65536,
): BlockColorTable {
  const rgb = new Uint8Array(size * 3);
  const emittedLightRgb = new Uint8Array(size * 3);
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
    const emittedLight = colorMap.getBlockPaletteEmittedLight(i);
    emittedLightRgb[off] = emittedLight.r;
    emittedLightRgb[off + 1] = emittedLight.g;
    emittedLightRgb[off + 2] = emittedLight.b;
    airLike[i] = colorMap.isBlockPaletteIndexAirLike(i) ? 1 : 0;
    renderKind[i] = colorMap.getBlockPaletteRenderKind(i);
    transparentBackface[i] = colorMap.blockPaletteIndexHasTransparentBackFace(i)
      ? 1
      : 0;
    transparentGroup[i] = colorMap.getBlockPaletteTransparentGroup(i);
  }
  return {
    rgb,
    emittedLightRgb,
    airLike,
    renderKind,
    transparentBackface,
    transparentGroup,
    signature: buildTableSignature(rgb, emittedLightRgb, airLike, renderKind),
  };
}

function buildTableSignature(...arrays: Uint8Array[]): string {
  let hash = 2166136261;
  for (const array of arrays) {
    for (let i = 0; i < array.length; i++) {
      hash ^= array[i] ?? 0;
      hash = Math.imul(hash, 16777619);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
