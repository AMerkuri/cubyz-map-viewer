import type { VoxelWorkPhase } from "./voxel-work.js";

const VOXEL_BINARY_MAGICS = new Set([
  0x324d5856, 0x334d5856, 0x344d5856, 0x354d5856, 0x364d5856,
]);
const BASE_BYTES_PER_QUAD = 4 * 3 * 4 * 3 + 6 * 4;
const ENHANCEMENT_BYTES_PER_QUAD = 4 * 3;

interface VoxelOutputEstimateInput {
  phase: VoxelWorkPhase;
  lod: number;
  buffer: ArrayBuffer;
}

export class VoxelOutputEstimator {
  private readonly ratios = new Map<string, number[]>();

  constructor(private readonly sampleLimit = 24) {}

  estimate(input: VoxelOutputEstimateInput): number {
    const compactBytes = Math.max(1, input.buffer.byteLength);
    const metadataEstimate = estimateFromCompactMetadata(input);
    const history = this.ratios.get(this.key(input.phase, input.lod)) ?? [];
    const historicalEstimate =
      history.length === 0
        ? 0
        : compactBytes * Math.max(...history.slice(-this.sampleLimit));
    return Math.max(compactBytes, metadataEstimate, historicalEstimate);
  }

  observe(input: VoxelOutputEstimateInput, actualBytes: number): void {
    this.observeActual(
      input.phase,
      input.lod,
      input.buffer.byteLength,
      actualBytes,
    );
  }

  observeActual(
    phase: VoxelWorkPhase,
    lod: number,
    compactBytes: number,
    actualBytes: number,
  ): void {
    if (compactBytes <= 0 || !Number.isFinite(actualBytes)) return;
    const key = this.key(phase, lod);
    const values = this.ratios.get(key) ?? [];
    values.push(Math.max(0, actualBytes) / compactBytes);
    if (values.length > this.sampleLimit) values.shift();
    this.ratios.set(key, values);
  }

  private key(phase: VoxelWorkPhase, lod: number): string {
    return `${phase}:${lod}`;
  }
}

function estimateFromCompactMetadata(input: VoxelOutputEstimateInput): number {
  if (input.buffer.byteLength < 20) return input.buffer.byteLength;
  const view = new DataView(input.buffer);
  const magic = view.getUint32(0, true);
  const quadOffset = VOXEL_BINARY_MAGICS.has(magic) ? 16 : 12;
  if (input.buffer.byteLength < quadOffset + 4) return input.buffer.byteLength;
  const quadCount = view.getUint32(quadOffset, true);
  const perQuad =
    input.phase === "base" ? BASE_BYTES_PER_QUAD : ENHANCEMENT_BYTES_PER_QUAD;
  return quadCount * perQuad + 64 * 1024;
}
