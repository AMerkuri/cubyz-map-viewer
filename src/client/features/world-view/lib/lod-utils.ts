import { LOD_LEVELS } from "./constants.js";

export function createVoxelLodDistanceThresholds(
  lod1MaxDist: number,
): { maxDist: number; lod: number }[] {
  return [
    { lod: 1, maxDist: lod1MaxDist },
    { lod: 2, maxDist: 1200 },
    { lod: 4, maxDist: 2400 },
    { lod: 8, maxDist: 4800 },
    { lod: 16, maxDist: 9600 },
    { lod: 32, maxDist: Infinity },
  ];
}

export function getLodForDistance(
  dist: number,
  thresholds: { maxDist: number; lod: number }[],
): number {
  for (const threshold of thresholds) {
    if (dist <= threshold.maxDist) return threshold.lod;
  }
  return 32;
}

export function getUnloadDistForLod(
  lod: number,
  thresholds: { maxDist: number; lod: number }[],
  unloadHysteresisRatio: number,
): number {
  const entry = thresholds.find((t) => t.lod === lod);
  if (!entry || entry.maxDist === Infinity) return Infinity;
  return entry.maxDist * unloadHysteresisRatio;
}

export function getLodForDistanceWithHysteresis(
  dist: number,
  previousLod: number,
  thresholds: { maxDist: number; lod: number }[],
  hysteresisRatio: number,
): number {
  const previousIndex = LOD_LEVELS.indexOf(previousLod);
  if (previousIndex === -1) return getLodForDistance(dist, thresholds);

  const previousMinBase =
    previousIndex > 0 ? (thresholds[previousIndex - 1]?.maxDist ?? 0) : 0;
  const previousMax = thresholds[previousIndex]?.maxDist ?? Infinity;
  const stickMin = previousMinBase * (1 - hysteresisRatio);
  const stickMax = Number.isFinite(previousMax)
    ? previousMax * (1 + hysteresisRatio)
    : Infinity;

  if (dist >= stickMin && dist <= stickMax) {
    return previousLod;
  }

  return getLodForDistance(dist, thresholds);
}

export function clampDistanceToLodRange(
  dist: number,
  lod: number,
  thresholds: { maxDist: number; lod: number }[],
): number {
  const lodIndex = LOD_LEVELS.indexOf(lod);
  if (lodIndex === -1) return dist;

  const lowerBase = lodIndex > 0 ? (thresholds[lodIndex - 1]?.maxDist ?? 0) : 0;
  const upperBase = thresholds[lodIndex]?.maxDist ?? Infinity;

  const lower = lodIndex > 0 ? lowerBase + 0.001 : 0;
  const upper = Number.isFinite(upperBase) ? upperBase - 0.001 : Infinity;
  return Math.min(Math.max(dist, lower), upper);
}
