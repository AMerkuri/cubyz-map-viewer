import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

import {
  collectVisibleMeshCandidates,
  createAnimationFrameCoalescer,
  createCursorInteractionHandlers,
} from "../../../src/client/features/world-view/lib/cursor.js";
import type {
  CursorHoverInfo,
  LoadedVoxelTile,
} from "../../../src/client/features/world-view/lib/types.js";

test("visible cursor candidates prune hidden branches while retaining visible meshes", () => {
  const root = new THREE.Group();
  const visibleVoxel = new THREE.Mesh(new THREE.BoxGeometry());
  const hiddenVoxel = new THREE.Mesh(new THREE.BoxGeometry());
  hiddenVoxel.visible = false;
  const hiddenBranch = new THREE.Group();
  hiddenBranch.visible = false;
  const hiddenTerrain = new THREE.Mesh(new THREE.PlaneGeometry());
  const visibleTerrain = new THREE.Mesh(new THREE.PlaneGeometry());

  root.add(visibleVoxel, hiddenVoxel, hiddenBranch, visibleTerrain);
  hiddenBranch.add(hiddenTerrain);

  assert.deepEqual(collectVisibleMeshCandidates(root), [
    visibleVoxel,
    visibleTerrain,
  ]);
});

test("animation-frame cursor refreshes coalesce, use current state, and cancel", () => {
  let nextHandle = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  const inspectedPointers: number[] = [];
  let pointerX = 0;
  const coalescer = createAnimationFrameCoalescer(
    {
      request(callback) {
        const handle = nextHandle++;
        callbacks.set(handle, callback);
        return handle;
      },
      cancel(handle) {
        callbacks.delete(handle);
      },
    },
    () => inspectedPointers.push(pointerX),
  );

  pointerX = 10;
  coalescer.request();
  pointerX = 20;
  coalescer.request();
  assert.equal(callbacks.size, 1);

  const [handle, callback] = callbacks.entries().next().value as [
    number,
    FrameRequestCallback,
  ];
  callbacks.delete(handle);
  callback(0);
  assert.deepEqual(inspectedPointers, [20]);

  coalescer.request();
  coalescer.cancel();
  assert.equal(callbacks.size, 0);
});

function createVoxelTile(mesh: THREE.Mesh, lod: number): LoadedVoxelTile {
  return {
    lod,
    regionX: 0,
    regionY: 0,
    subMeshes: [
      {
        mesh,
        trianglePaletteIndices: new Uint32Array(12).fill(lod),
      },
    ],
    transparentSubMeshes: [],
  } as unknown as LoadedVoxelTile;
}

function createPointerEvent(
  overrides: Partial<PointerEvent> = {},
): PointerEvent {
  return {
    clientX: 50,
    clientY: 50,
    pointerType: "mouse",
    pointerId: 1,
    isPrimary: true,
    buttons: 0,
    ...overrides,
  } as PointerEvent;
}

test("cursor picks visible fine voxel LOD before terrain and suppresses stale refreshes", () => {
  const originalWindow = globalThis.window;
  let nextHandle = 1;
  const animationFrames = new Map<number, FrameRequestCallback>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      cancelAnimationFrame(handle: number) {
        animationFrames.delete(handle);
      },
      clearTimeout() {},
      requestAnimationFrame(callback: FrameRequestCallback) {
        const handle = nextHandle++;
        animationFrames.set(handle, callback);
        return handle;
      },
      setTimeout() {
        return 0;
      },
    },
  });

  try {
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const voxelGroup = new THREE.Group();
    const terrainGroup = new THREE.Group();
    const coarseVoxel = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    const fineVoxel = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    fineVoxel.position.z = 0.1;
    const terrain = new THREE.Mesh(new THREE.PlaneGeometry(20, 20));
    terrain.position.z = -1;
    coarseVoxel.userData.voxelKey = "coarse";
    fineVoxel.userData.voxelKey = "fine";
    voxelGroup.add(coarseVoxel, fineVoxel);
    terrainGroup.add(terrain);
    voxelGroup.updateMatrixWorld(true);
    terrainGroup.updateMatrixWorld(true);

    const updates: (CursorHoverInfo | null)[] = [];
    const handlers = createCursorInteractionHandlers({
      renderer: {
        domElement: {
          getBoundingClientRect: () => ({
            bottom: 100,
            height: 100,
            left: 0,
            right: 100,
            top: 0,
            width: 100,
          }),
        },
      } as unknown as THREE.WebGLRenderer,
      camera,
      showTerrainUnderlayRef: { current: true },
      showChunkBordersRef: { current: true },
      debugEnabledRef: { current: true },
      terrainGroupRef: { current: terrainGroup },
      voxelGroupRef: { current: voxelGroup },
      loadedVoxelsRef: {
        current: new Map([
          ["coarse", createVoxelTile(coarseVoxel, 4)],
          ["fine", createVoxelTile(fineVoxel, 1)],
        ]),
      },
      getBlockIdForPaletteIndex: (paletteIndex) => `block-${paletteIndex}`,
      keysHeldRef: { current: new Set() },
      onCursorMoveRef: { current: (info) => updates.push(info) },
    });

    function runFrame() {
      const [handle, callback] = animationFrames.entries().next().value as [
        number,
        FrameRequestCallback,
      ];
      animationFrames.delete(handle);
      callback(0);
    }

    handlers.onPointerMove(createPointerEvent());
    runFrame();
    assert.equal(updates.at(-1)?.blockId, "block-1");
    assert.equal(updates.at(-1)?.voxelChunkLod, 1);

    fineVoxel.visible = false;
    coarseVoxel.visible = false;
    handlers.onPointerMove(createPointerEvent());
    runFrame();
    assert.equal(updates.at(-1)?.blockId, undefined);
    assert.deepEqual(updates.at(-1)?.pos, [0, 0, 0]);

    handlers.onPointerMove(createPointerEvent());
    handlers.onPointerDown(createPointerEvent());
    assert.equal(animationFrames.size, 0);

    handlers.onPointerUp(createPointerEvent());
    handlers.onPointerMove(createPointerEvent());
    handlers.onPointerLeave(createPointerEvent());
    assert.equal(animationFrames.size, 0);
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  }
});
