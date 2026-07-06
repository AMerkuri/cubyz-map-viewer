import type * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { getLodBorderColor } from "./primitives.js";
import type { LoadedTerrainTile, LoadedVoxelTile } from "./types.js";
import { countBits16, formatHeight, regionWorldSize } from "./utils.js";

export function clearCssLabelMap(
  group: THREE.Group | null,
  labelMap: Map<string, CSS2DObject>,
): void {
  if (!group) return;
  for (const label of labelMap.values()) {
    group.remove(label);
  }
  labelMap.clear();
}

export function refreshDebugLabels(args: {
  group: THREE.Group | null;
  labelMap: Map<string, CSS2DObject>;
  debugEnabled: boolean;
  showTiles: boolean;
  showHeights: boolean;
  loadedTerrain: Iterable<LoadedTerrainTile>;
  loadedVoxels: Iterable<LoadedVoxelTile>;
}): void {
  const {
    group,
    labelMap,
    debugEnabled,
    showTiles,
    showHeights,
    loadedVoxels,
  } = args;
  if (!group) return;
  if (!debugEnabled) {
    clearCssLabelMap(group, labelMap);
    return;
  }
  if (!showTiles && !showHeights) {
    clearCssLabelMap(group, labelMap);
    return;
  }

  const active = new Set<string>();

  for (const tile of loadedVoxels) {
    if (!tile.borderLines.visible && !showHeights) continue;
    const key = tile.key;
    active.add(key);

    const parts: string[] = [];
    if (showTiles) {
      parts.push(`V L${tile.lod} ${tile.regionX}/${tile.regionY}`);
    }
    if (showHeights) {
      const tops = [...tile.chunkTopHeights].filter((v) => Number.isFinite(v));
      const topMin = tops.length > 0 ? Math.min(...tops) : Number.NaN;
      const topMax = tops.length > 0 ? Math.max(...tops) : Number.NaN;
      const covered = countBits16(tile.chunkCoverage);
      parts.push(
        `topMin:${formatHeight(topMin)} topMax:${formatHeight(topMax)} cov:${covered}/16`,
      );
    }
    if (parts.length === 0) continue;

    const text = parts.join("  ");
    const regSize = regionWorldSize(tile.lod);
    const x = tile.regionX + regSize / 2;
    const y = tile.regionY + regSize / 2;
    const z = tile.maxZ + 6;

    const lodColor = getLodBorderColor(tile.lod).label;
    let label = labelMap.get(key);
    if (label) {
      const el = label.element as HTMLDivElement;
      el.textContent = text;
      if (showTiles) {
        el.style.color = lodColor;
        el.style.borderColor = lodColor;
      }
      label.position.set(x, y, z);
    } else {
      const div = document.createElement("div");
      div.textContent = text;
      div.style.cssText = `color: ${showTiles ? lodColor : "#00ff88"}; font-size: 11px; font-family: monospace; font-weight: bold; background: rgba(0, 0, 0, 0.7); padding: 2px 4px; border: 1px solid ${showTiles ? lodColor : "#00ff88"}; border-radius: 3px; white-space: nowrap; pointer-events: none;`;
      label = new CSS2DObject(div);
      label.position.set(x, y, z);
      group.add(label);
      labelMap.set(key, label);
    }
  }

  for (const [key, label] of labelMap) {
    if (!active.has(key)) {
      group.remove(label);
      labelMap.delete(key);
    }
  }
}
