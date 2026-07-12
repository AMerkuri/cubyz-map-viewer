import { after, test } from "node:test";
import { sampleSerial } from "../support/benchmark.js";
import {
  colors,
  EMITTER,
  REGION_SIZE,
  shapes,
  stonePlane,
  withTemporarySave,
  writeAdjacentFixture,
  writeRegions,
  writeSurface,
} from "../support/fixture-world.js";
import { cleanupVoxelCache, generateLod1 } from "../support/production.js";
import { buildWithProductionWorker } from "../support/worker-harness.js";

after(cleanupVoxelCache);

test("benchmark client baseline payload decoding", async () => {
  await withTemporarySave("bench-client-baseline", async (save) => {
    await writeSurface(save);
    await writeRegions(save, [
      ...stonePlane(),
      { x: 64, y: 64, z: 1, type: EMITTER },
    ]);
    const generated = await generateLod1(save, colors, shapes);
    if (!generated.buffer) throw new Error("baseline payload missing");
    const mesh = await buildWithProductionWorker(generated.buffer.slice(0));
    await sampleSerial("client-baseline-decode", async () => {
      await buildWithProductionWorker(generated.buffer.slice(0));
    });
    console.log(
      JSON.stringify({
        benchmark: "client-baseline-decode-structure",
        payloadBytes: generated.buffer.byteLength,
        outputVertices: mesh.quadrantMeshes.reduce(
          (sum, quadrant) => sum + quadrant.positions.length / 3,
          0,
        ),
        emissivePhase: mesh.emissivePhase,
      }),
    );
  });
});

test("benchmark client dense emissive baking", async () => {
  await withTemporarySave("bench-client-dense", async (save) => {
    await writeAdjacentFixture(save, true);
    const generated = await generateLod1(save, colors, shapes);
    if (!generated.buffer) throw new Error("dense payload missing");
    const mesh = await buildWithProductionWorker(generated.buffer.slice(0));
    await sampleSerial("client-dense-emissive", async () => {
      await buildWithProductionWorker(generated.buffer.slice(0));
    });
    console.log(
      JSON.stringify({
        benchmark: "client-dense-emissive-structure",
        payloadBytes: generated.buffer.byteLength,
        outputVertices: mesh.quadrantMeshes.reduce(
          (sum, quadrant) => sum + quadrant.positions.length / 3,
          0,
        ),
        emissivePhase: mesh.emissivePhase,
      }),
    );
  });
});

test("benchmark client adjacent seam pair", async () => {
  await withTemporarySave("bench-client-seam", async (save) => {
    await writeAdjacentFixture(save, true);
    const west = await generateLod1(save, colors, shapes);
    const east = await generateLod1(save, colors, shapes, REGION_SIZE, 0);
    if (!west.buffer || !east.buffer) throw new Error("seam payload missing");
    const [westMesh, eastMesh] = await Promise.all([
      buildWithProductionWorker(west.buffer.slice(0)),
      buildWithProductionWorker(east.buffer.slice(0)),
    ]);
    await sampleSerial("client-adjacent-seam", async () => {
      await buildWithProductionWorker(west.buffer.slice(0));
      await buildWithProductionWorker(east.buffer.slice(0));
    });
    console.log(
      JSON.stringify({
        benchmark: "client-adjacent-seam-structure",
        payloadBytes: west.buffer.byteLength + east.buffer.byteLength,
        outputVertices: [
          ...westMesh.quadrantMeshes,
          ...eastMesh.quadrantMeshes,
        ].reduce((sum, quadrant) => sum + quadrant.positions.length / 3, 0),
        westEmissivePhase: westMesh.emissivePhase,
        eastEmissivePhase: eastMesh.emissivePhase,
      }),
    );
  });
});
