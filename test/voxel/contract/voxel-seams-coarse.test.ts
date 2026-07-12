import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { EmitterSummaryCluster } from "../../../src/server/services/voxel-emitter-aggregation.js";
import { EMITTER_SUMMARY_FORMAT_VERSION } from "../../../src/server/services/voxel-emitter-aggregation.js";
import {
  colors,
  REGION_SIZE,
  shapes,
  stonePlane,
  withTemporarySave,
  writeRegions,
  writeSurface,
} from "../support/fixture-world.js";
import { cleanupVoxelCache, generateVoxelMesh } from "../support/production.js";
import { collectSeamEmissive, maxSeamDelta } from "../support/seam-colors.js";
import { buildWithProductionWorker } from "../support/worker-harness.js";

after(cleanupVoxelCache);

test("contract coarse seam colors use production summary payload records", async () => {
  await withTemporarySave("contract-lod2", async (save) => {
    const lod = 2;
    const span = REGION_SIZE * lod;
    await writeSurface(save, lod);
    await writeRegions(save, stonePlane(span * 2, span, lod), lod);
    const clusters = [
      cluster(span - 6, 128, 5, 220, 80, 20),
      cluster(span + 6, 132, 5, 20, 100, 255),
    ];
    const west = await generate(save, 0, clusters);
    const east = await generate(save, span, clusters);
    const [westMesh, eastMesh] = await Promise.all([
      buildWithProductionWorker(west.slice(0)),
      buildWithProductionWorker(east.slice(0)),
    ]);
    const seam = maxSeamDelta(
      collectSeamEmissive(westMesh, span, 0, span, lod),
      collectSeamEmissive(eastMesh, span, 0, span, lod),
    );
    assert.ok(seam.count > 0, "coarse payloads produce matching seam vertices");
    assert.ok(
      seam.delta <= 1 / 255,
      `coarse normalized seam delta ${seam.delta} is within active encoding tolerance`,
    );
  });
});

async function generate(
  save: string,
  regionX: number,
  clusters: EmitterSummaryCluster[],
): Promise<ArrayBuffer> {
  const result = await generateVoxelMesh(save, colors, shapes, 2, regionX, 0, {
    emitterSummary: {
      formatVersion: EMITTER_SUMMARY_FORMAT_VERSION,
      lod: 2,
      regionX,
      regionY: 0,
      sourceSignature: "coarse-contract-fixture",
      signature: `coarse-contract-fixture-${regionX}`,
      rawSourceCount: clusters.length,
      cappedClusterCount: 0,
      clusters,
    },
  });
  if (!result.buffer) throw new Error("coarse fixture produced no mesh");
  return result.buffer;
}

function cluster(
  centroidX: number,
  centroidY: number,
  centroidZ: number,
  powerR: number,
  powerG: number,
  powerB: number,
): EmitterSummaryCluster {
  return {
    centroidX,
    centroidY,
    centroidZ,
    powerR,
    powerG,
    powerB,
    centroidWeight: 1,
    sourceCount: 1,
    openFaces: 0b11_1111,
    minX: centroidX - 0.5,
    minY: centroidY - 0.5,
    minZ: centroidZ - 0.5,
    maxX: centroidX + 0.5,
    maxY: centroidY + 0.5,
    maxZ: centroidZ + 0.5,
    representedLods: 1,
  };
}
