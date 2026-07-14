import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as THREE from "three";
import { BlockLightRuntimeManager } from "../../../src/client/features/world-view/lib/block-light-runtime.js";
import type {
  LoadedVoxelTile,
  VoxelEmitterRecord,
} from "../../../src/client/features/world-view/lib/types.js";

const originalDocument = globalThis.document;

before(() => {
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement: () => ({
        height: 0,
        width: 0,
        getContext: () => null,
      }),
    },
  });
});

after(() => {
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: originalDocument,
  });
});

const emitter: VoxelEmitterRecord = {
  x: 816,
  y: 5456,
  z: 48,
  r: 255,
  g: 212,
  b: 175,
  halo: false,
  power: 2,
  radius: 28,
};

function tile(lod: number): LoadedVoxelTile {
  return {
    key: `${lod}/0/4096`,
    lod,
    emitterRecords: [emitter],
  } as LoadedVoxelTile;
}

test("runtime accents ignore aggregate coarse representatives", () => {
  const manager = new BlockLightRuntimeManager(new THREE.Scene());
  manager.syncRegions([tile(32)]);
  const stats = manager.update({
    enabled: true,
    quality: 1,
    timeOfDay: 0,
    cameraPosition: new THREE.Vector3(816, 5456, 48),
  });

  assert.equal(stats.decodedEmitters, 1);
  assert.equal(stats.activeEmitters, 0);
  assert.equal(stats.glowPoolUsed, 0);
  manager.dispose();
});

test("runtime accents retain represented LOD 1 sources", () => {
  const manager = new BlockLightRuntimeManager(new THREE.Scene());
  manager.syncRegions([tile(1)]);
  const stats = manager.update({
    enabled: true,
    quality: 1,
    timeOfDay: 0,
    cameraPosition: new THREE.Vector3(816, 5456, 48),
  });

  assert.equal(stats.activeEmitters, 1);
  assert.equal(stats.glowPoolUsed, 1);
  manager.dispose();
});
