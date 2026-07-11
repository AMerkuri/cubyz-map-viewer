export const EMITTER_SUMMARY_FORMAT_VERSION = 1;
const EMITTER_SUMMARY_SOURCE_STRATEGY = "lod1-summary-v1";
const EMITTER_SUMMARY_EXPOSURE_VERSION = "six-neighbor-v1";
const EMITTER_SUMMARY_CLUSTER_VERSION = "world-grid-top-stratified-v2";
const EMITTER_METADATA_VERSION = "q8.8-radius-u8-radius-gain-v3";
export const EMITTER_DEFAULT_POWER = 1;
export const EMITTER_DEFAULT_RADIUS = 12;
export const EMITTER_COARSE_BASE_RADIUS = 14;
export const EMITTER_POWER_FIXED_SCALE = 256;
export const EMITTER_MAX_POWER = 0xffff / EMITTER_POWER_FIXED_SCALE;
export const EMITTER_MAX_RADIUS = 64;
export const EMITTER_MAX_SUMMARY_RADIUS = 28;
export const EMITTER_SUMMARY_REQUEST_TIMEOUT_MS = 30_000;
const EMITTER_MAX_INDEX_CELLS = 512;
const EMITTER_MAX_CLIENT_GAIN = 8;

export const EMITTER_SUMMARY_LODS = [1, 2, 4, 8, 16, 32] as const;
export type EmitterSummaryLod = (typeof EMITTER_SUMMARY_LODS)[number];

export interface EmitterSummaryCluster {
  powerR: number;
  powerG: number;
  powerB: number;
  centroidX: number;
  centroidY: number;
  centroidZ: number;
  centroidWeight: number;
  sourceCount: number;
  openFaces: number;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface EmitterSummaryNode {
  formatVersion: number;
  lod: EmitterSummaryLod;
  regionX: number;
  regionY: number;
  sourceSignature: string;
  signature: string;
  rawSourceCount: number;
  cappedClusterCount: number;
  clusters: EmitterSummaryCluster[];
}

export interface EmitterSummaryBuildMetrics {
  cacheOutcome: "memory" | "disk" | "built";
  buildMs: number;
  leafParses: number;
  rawSourceCount: number;
  retainedClusterCount: number;
  cappedClusterCount: number;
}

export interface EmitterSummaryResult {
  node: EmitterSummaryNode;
  metrics: EmitterSummaryBuildMetrics;
}

export const EMITTER_SUMMARY_CLUSTER_EDGE_BY_LOD: Record<
  EmitterSummaryLod,
  number
> = {
  1: 8,
  2: 16,
  4: 32,
  8: 64,
  16: 128,
  32: 256,
};

export const EMITTER_SUMMARY_LIMIT_BY_LOD: Record<EmitterSummaryLod, number> = {
  1: 256,
  2: 256,
  4: 256,
  8: 256,
  16: 256,
  32: 256,
};

export function isEmitterSummaryLod(value: number): value is EmitterSummaryLod {
  return EMITTER_SUMMARY_LODS.includes(value as EmitterSummaryLod);
}

export const EMITTER_SUMMARY_SIGNATURE = [
  EMITTER_SUMMARY_SOURCE_STRATEGY,
  EMITTER_SUMMARY_FORMAT_VERSION,
  EMITTER_SUMMARY_EXPOSURE_VERSION,
  EMITTER_SUMMARY_CLUSTER_VERSION,
  EMITTER_METADATA_VERSION,
  EMITTER_POWER_FIXED_SCALE,
  EMITTER_MAX_POWER,
  EMITTER_DEFAULT_POWER,
  EMITTER_DEFAULT_RADIUS,
  EMITTER_COARSE_BASE_RADIUS,
  EMITTER_MAX_RADIUS,
  EMITTER_MAX_SUMMARY_RADIUS,
  EMITTER_MAX_INDEX_CELLS,
  EMITTER_MAX_CLIENT_GAIN,
  ...EMITTER_SUMMARY_LODS.flatMap((lod) => [
    lod,
    EMITTER_SUMMARY_CLUSTER_EDGE_BY_LOD[lod],
    EMITTER_SUMMARY_LIMIT_BY_LOD[lod],
  ]),
].join(":");
