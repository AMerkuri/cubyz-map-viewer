import assert from "node:assert/strict";
import { request } from "node:http";
import { test } from "node:test";

import express from "express";
import * as THREE from "three";
import { handleTerrainTileUpdate } from "../../../src/client/features/world-view/lib/live-updates.js";
import { buildFullTileMesh } from "../../../src/client/features/world-view/lib/terrain-builders.js";
import { terrainTileKey } from "../../../src/client/features/world-view/lib/terrain-manager.js";
import type { TerrainMeshData } from "../../../src/client/features/world-view/lib/types.js";
import { createTerrainRouter } from "../../../src/server/api/terrain.js";
import type { ColorMapService } from "../../../src/server/services/color-map.js";
import { withTemporarySave } from "../../voxel/support/fixture-world.js";
import {
  writeAdjacentTerrainFixture,
  writeSurfaceTile,
} from "../support/terrain-fixture.js";

const colorMap = {
  getBiomeColor: () => ({ r: 100, g: 140, b: 80 }),
  isOceanBiome: () => false,
} as unknown as ColorMapService;

async function loadTerrain(
  save: string,
  tileX: number,
  tileY: number,
): Promise<TerrainMeshData> {
  const app = express();
  app.use("/terrain", createTerrainRouter(save, colorMap));
  const server = app.listen(0);
  try {
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No test port");
    const body = await new Promise<Buffer>((resolve, reject) => {
      const req = request(
        {
          host: "127.0.0.1",
          port: address.port,
          path: `/terrain/1/${tileX}/${tileY}`,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            if (res.statusCode !== 200)
              reject(new Error(`Unexpected ${res.statusCode}`));
            else resolve(Buffer.concat(chunks));
          });
        },
      );
      req.on("error", reject);
      req.end();
    });
    return JSON.parse(body.toString()) as TerrainMeshData;
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test("adjacent parsed terrain responses build matching world-border positions and normals", async () => {
  await withTemporarySave("terrain-seam", async (save) => {
    await writeAdjacentTerrainFixture(save);
    const [leftData, rightData] = await Promise.all([
      loadTerrain(save, 0, 0),
      loadTerrain(save, 1, 0),
    ]);
    const material = new THREE.MeshBasicMaterial();
    const [left, right] = [
      buildFullTileMesh(leftData, material),
      buildFullTileMesh(rightData, material),
    ];
    const leftPositions = left.geometry.getAttribute("position");
    const rightPositions = right.geometry.getAttribute("position");
    const leftNormals = left.geometry.getAttribute("normal");
    const rightNormals = right.geometry.getAttribute("normal");
    for (let row = 0; row < leftData.meshHeight; row++) {
      const leftIndex = row * leftData.meshWidth + leftData.meshWidth - 1;
      const rightIndex = row * rightData.meshWidth;
      for (let axis = 0; axis < 3; axis++) {
        const leftPosition =
          leftPositions.getComponent(leftIndex, axis) +
          left.position.getComponent(axis);
        const rightPosition =
          rightPositions.getComponent(rightIndex, axis) +
          right.position.getComponent(axis);
        assert.ok(Math.abs(leftPosition - rightPosition) < 1e-6);
        assert.ok(
          Math.abs(
            leftNormals.getComponent(leftIndex, axis) -
              rightNormals.getComponent(rightIndex, axis),
          ) < 1e-6,
        );
      }
    }
    left.geometry.dispose();
    right.geometry.dispose();
    material.dispose();
  });
});

test("a changed gutter source covers its neighboring tile for eviction and rebuild", async () => {
  await withTemporarySave("terrain-gutter", async (save) => {
    await writeAdjacentTerrainFixture(save);
    await writeSurfaceTile(save, 0, 0, 100);
    const evicted: string[] = [];
    const queued: string[] = [];
    handleTerrainTileUpdate({
      lod: 1,
      tileX: 0,
      tileY: 0,
      queryClient: { invalidateQueries: () => Promise.resolve() } as never,
      showTerrainUnderlay: true,
      loadedTerrain: new Map(),
      evictWarmCachedTerrainTile: (key) => evicted.push(key),
      queueTerrainTileLoad: (lod, tileX, tileY) =>
        queued.push(terrainTileKey(lod, tileX, tileY)),
      disposeTerrainTile: () => {},
      debugLabelsDirtyRef: { current: false },
      biomeLabelsDirtyRef: { current: false },
    });
    const eastNeighbor = terrainTileKey(1, 1, 0);
    assert.ok(evicted.includes(eastNeighbor));
    assert.ok(queued.includes(eastNeighbor));
  });
});
