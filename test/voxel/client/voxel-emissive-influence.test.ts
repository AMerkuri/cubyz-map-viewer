import assert from "node:assert/strict";
import { after, test } from "node:test";

import { encodeBinaryQuads } from "../../../src/server/services/greedy-mesh.js";
import {
  colors,
  EMITTER,
  shapes,
  stonePlane,
  withTemporarySave,
  writeRegions,
  writeSurface,
} from "../support/fixture-world.js";
import { getEmitterRecordOffset } from "../support/payload-records.js";
import { cleanupVoxelCache, generateLod1 } from "../support/production.js";
import { buildWithProductionWorker } from "../support/worker-harness.js";

after(cleanupVoxelCache);

test("client worker applies in-radius, out-of-radius, and open-face emitter influence", async () => {
  await withTemporarySave("worker-influence", async (save) => {
    await writeSurface(save);
    await writeRegions(save, [
      ...stonePlane(),
      { x: 64, y: 64, z: 1, type: EMITTER },
    ]);
    const generated = await generateLod1(save, colors, shapes);
    assert.ok(generated.buffer);
    const withinRadius = await buildWithProductionWorker(
      generated.buffer.slice(0),
    );
    const distant = generated.buffer.slice(0);
    const restricted = generated.buffer.slice(0);
    const offset = getEmitterRecordOffset(distant);
    new DataView(distant).setInt32(offset, 10_000, true);
    // Zero is the legacy "all faces open" encoding, so retain only +X here.
    new DataView(restricted).setUint8(offset + 15, 0b10);
    const [outsideRadius, closedFaces] = await Promise.all([
      buildWithProductionWorker(distant),
      buildWithProductionWorker(restricted),
    ]);
    const inRadiusEnergy = emissiveEnergy(withinRadius);
    assert.ok(inRadiusEnergy > 0, "nearby generated emitter affects mesh");
    assert.equal(
      emissiveEnergy(outsideRadius),
      0,
      "out-of-radius emitter does not affect mesh",
    );
    assert.ok(
      emissiveEnergy(closedFaces) < inRadiusEnergy,
      "closed emitter faces restrict directional transmission",
    );
  });
});

test("client worker keeps outside-primary-cell emitters with unrelated primary records", async () => {
  const [withoutRelevant, withRelevant] = await Promise.all([
    buildWithProductionWorker(createCandidateDiscoveryPayload(false)),
    buildWithProductionWorker(createCandidateDiscoveryPayload(true)),
  ]);
  const receiver = [71, 71, 0] as const;
  assert.deepEqual(
    emissiveAt(withoutRelevant, ...receiver),
    [0, 0, 0],
    "unrelated primary-cell records are outside the receiving vertex radius",
  );
  assert.ok(
    emissiveAt(withRelevant, ...receiver).some((channel) => channel > 0),
    "an in-radius emitter outside the receiver primary grid cell contributes",
  );
});

test("receiver-cell caching preserves output and separates discovery metrics from contributions", async () => {
  const payload = createCandidateDiscoveryPayload(true);
  const [uncached, cached] = await Promise.all([
    buildWithProductionWorker(payload.slice(0), {
      candidateNeighborhoodMode: "uncached",
    }),
    buildWithProductionWorker(payload.slice(0), {
      candidateNeighborhoodMode: "cached",
    }),
  ]);

  assert.deepEqual(cached.emitterRecords, uncached.emitterRecords);
  assert.deepEqual(
    cached.quadrantMeshes.map((quadrant) => quadrant.positions),
    uncached.quadrantMeshes.map((quadrant) => quadrant.positions),
  );
  assert.deepEqual(
    cached.quadrantMeshes.map((quadrant) => quadrant.emissiveColors),
    uncached.quadrantMeshes.map((quadrant) => quadrant.emissiveColors),
  );
  assert.ok(cached.emissivePhase.receiverEvaluations > 0);
  assert.equal(
    uncached.emissivePhase.neighborhoodCellProbes,
    uncached.emissivePhase.receiverEvaluations * 27,
  );
  assert.ok(
    cached.emissivePhase.neighborhoodCellProbes <
      uncached.emissivePhase.neighborhoodCellProbes,
  );
  assert.ok(cached.emissivePhase.cacheHits > 0);
  assert.ok(cached.emissivePhase.cacheMisses > 0);
  assert.notEqual(
    cached.emissivePhase.candidateVisits,
    cached.emissivePhase.neighborhoodCellProbes,
    "final contributions must not be reported as neighborhood discovery work",
  );
});

test("disabled emissive baking reports skipped discovery and output work", async () => {
  const result = await buildWithProductionWorker(
    createCandidateDiscoveryPayload(true),
    {
      bakeEmissiveAttributes: false,
      candidateNeighborhoodMode: "cached",
    },
  );

  assert.equal(result.emissivePhase.skipped, true);
  assert.equal(result.emissivePhase.receiverEvaluations, 0);
  assert.equal(result.emissivePhase.neighborhoodCellProbes, 0);
  assert.equal(result.emissivePhase.candidateVisits, 0);
  assert.equal(result.emissivePhase.cacheHits, 0);
  assert.equal(result.emissivePhase.cacheMisses, 0);
  assert.equal(result.emissivePhase.peakAccountedCacheBytes, 0);
  assert.ok(
    result.quadrantMeshes.every((quadrant) => quadrant.emissiveColors === null),
  );
});

test("cache pressure falls back to uncached discovery without changing output", async () => {
  const payload = createCandidateDiscoveryPayload(true);
  const [uncached, bounded] = await Promise.all([
    buildWithProductionWorker(payload.slice(0), {
      candidateNeighborhoodMode: "uncached",
    }),
    buildWithProductionWorker(payload.slice(0), {
      candidateNeighborhoodMode: "cached",
      candidateCacheMaxBytes: 0,
    }),
  ]);

  assert.deepEqual(
    bounded.quadrantMeshes.map((quadrant) => quadrant.emissiveColors),
    uncached.quadrantMeshes.map((quadrant) => quadrant.emissiveColors),
  );
  assert.ok(bounded.emissivePhase.uncachedFallbacks > 0);
  assert.equal(bounded.emissivePhase.peakAccountedCacheBytes, 0);
});

function emissiveEnergy(
  mesh: Awaited<ReturnType<typeof buildWithProductionWorker>>,
): number {
  let total = 0;
  for (const quadrant of mesh.quadrantMeshes) {
    for (const value of quadrant.emissiveColors ?? []) total += value;
  }
  return total;
}

function createCandidateDiscoveryPayload(
  includeRelevant: boolean,
): ArrayBuffer {
  const unrelatedPrimaryRecords = [
    { x: 60, y: 60, z: 1, r: 255, g: 80, b: 20, openFaces: 0x3f },
    { x: 60, y: 61, z: 1, r: 255, g: 80, b: 20, openFaces: 0x3f },
  ];
  return encodeBinaryQuads(
    [
      {
        v0x: 70,
        v0y: 70,
        v0z: 0,
        v1x: 71,
        v1y: 70,
        v1z: 0,
        v2x: 71,
        v2y: 71,
        v2z: 0,
        v3x: 70,
        v3y: 71,
        v3z: 0,
        typ: 1,
        dir: 1,
        packedAo: 0,
        renderKind: 1,
        sourceKind: "greedy",
        face: 5,
        plane: 0,
        u: 70,
        v: 70,
        du: 1,
        dv: 1,
      },
    ],
    [],
    0,
    0,
    0,
    1,
    colors,
    1,
    [
      ...unrelatedPrimaryRecords,
      ...(includeRelevant
        ? [{ x: 72, y: 71, z: 1, r: 255, g: 80, b: 20, openFaces: 0x3f }]
        : []),
    ],
  ).buffer;
}

function emissiveAt(
  mesh: Awaited<ReturnType<typeof buildWithProductionWorker>>,
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  for (const quadrant of mesh.quadrantMeshes) {
    for (let index = 0; index < quadrant.positions.length; index += 3) {
      if (
        quadrant.positions[index] === x &&
        quadrant.positions[index + 1] === y &&
        quadrant.positions[index + 2] === z
      ) {
        return [
          quadrant.emissiveColors?.[index] ?? 0,
          quadrant.emissiveColors?.[index + 1] ?? 0,
          quadrant.emissiveColors?.[index + 2] ?? 0,
        ];
      }
    }
  }
  throw new Error(`missing emissive receiver vertex ${x}/${y}/${z}`);
}
