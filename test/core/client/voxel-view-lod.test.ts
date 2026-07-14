import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import type {
  LoadedVoxelTile,
  WarmCachedVoxelTile,
} from "../../../src/client/features/world-view/lib/types.js";
import { voxelTileKey } from "../../../src/client/features/world-view/lib/voxel-index.js";
import { runVoxelLodSelection } from "../../../src/client/features/world-view/lib/voxel-lod.js";
import {
  classifyVoxelView,
  getReferenceVoxelViewBounds,
} from "../../../src/client/features/world-view/lib/voxel-view.js";
import type { VoxelViewClass } from "../../../src/client/features/world-view/lib/voxel-work.js";

const LODS = [1, 2, 4, 8, 16, 32];
const thresholds = [
  { maxDist: 100_000, lod: 1 },
  { maxDist: 110_000, lod: 2 },
  { maxDist: 120_000, lod: 4 },
  { maxDist: 130_000, lod: 8 },
  { maxDist: 140_000, lod: 16 },
  { maxDist: Infinity, lod: 32 },
];

function runSelection(args: {
  cameraForward: THREE.Vector3;
  cameraPosition?: THREE.Vector3;
  focusPoint?: THREE.Vector3 | null;
  availableLods?: number[];
  viewClasses?: Map<string, VoxelViewClass>;
  generation?: number;
  screenSpaceDistanceScale?: number;
  renderDistance?: number;
  rootLod?: number;
  loadedVoxels?: Map<string, LoadedVoxelTile>;
  warmCachedVoxels?: Map<string, WarmCachedVoxelTile>;
}) {
  const availableLods = args.availableLods ?? LODS;
  return runVoxelLodSelection({
    focusLod: 1,
    cameraPosition: args.cameraPosition ?? new THREE.Vector3(64, -30_000, 0),
    referenceSurfaceZ: 0,
    cameraForward: args.cameraForward,
    screenSpaceDistanceScale: args.screenSpaceDistanceScale ?? 1,
    cameraFov: 60,
    viewportHeight: 1080,
    viewportAspect: 16 / 9,
    focusPoint: args.focusPoint ?? null,
    roots: [{ lod: args.rootLod ?? 32, regionX: 0, regionY: 0 }],
    availableVoxelKeys: new Set(
      availableLods.map((lod) => voxelTileKey(lod, 0, 0)),
    ),
    loadedVoxels: args.loadedVoxels ?? new Map(),
    warmCachedVoxels: args.warmCachedVoxels ?? new Map(),
    loadingVoxels: new Set(),
    pendingVoxelMeshQueue: [],
    voxelUnloadGraceUntil: new Map(),
    voxelThresholds: thresholds,
    renderDistance: args.renderDistance ?? 150_000,
    minRenderedVoxelLod: 1,
    requestGeneration: args.generation ?? 1,
    now: 10_000,
    stableForDetail: true,
    debugSettings: {
      voxelBehindCameraDotStart: -0.5,
      voxelBehindCameraMaxMultiplier: 1.05,
      lodUnloadHysteresis: 1.5,
      voxelLodHysteresisRatio: 0,
      voxelTopAoIntensity: 1,
      voxelWallAoIntensity: 0.5,
      voxelUnloadGraceMs: 750,
      voxelViewEnterMarginDegrees: 12,
      voxelViewExitMarginDegrees: 18,
    },
    voxelViewClasses: args.viewClasses ?? new Map(),
    getVoxelRefreshVersion: () => 0,
    isVoxelTileStale: () => false,
    unloadVoxelTile: () => {},
  });
}

function requestedLods(result: ReturnType<typeof runSelection>): number[] {
  return [...result.requestedVoxelRequests.values()]
    .filter((request) => request.regionX === 0 && request.regionY === 0)
    .map((request) => request.lod)
    .sort((a, b) => a - b);
}

test("conservative classifier uses full camera direction and fallback bounds", () => {
  assert.equal(
    classifyVoxelView({
      cameraPosition: { x: 0, y: 0, z: 0 },
      cameraDirection: { x: 0, y: 0, z: 1 },
      verticalFovDegrees: 60,
      viewportAspect: 16 / 9,
      bounds: getReferenceVoxelViewBounds({
        regionX: -16,
        regionY: -16,
        worldSize: 32,
        referenceSurfaceZ: 1_000,
      }),
      enterMarginDegrees: 12,
      exitMarginDegrees: 18,
    }),
    "forward",
  );
});

test("rotation hysteresis retains forward classification through the exit margin", () => {
  const angle = (57 * Math.PI) / 180;
  const bounds = {
    minX: Math.sin(angle) * 1_000 - 1,
    maxX: Math.sin(angle) * 1_000 + 1,
    minY: Math.cos(angle) * 1_000 - 1,
    maxY: Math.cos(angle) * 1_000 + 1,
    minZ: -1,
    maxZ: 1,
  };
  const input = {
    cameraPosition: { x: 0, y: 0, z: 0 },
    cameraDirection: { x: 0, y: 1, z: 0 },
    verticalFovDegrees: 60,
    viewportAspect: 1,
    bounds,
    enterMarginDegrees: 12,
    exitMarginDegrees: 18,
  };
  assert.equal(classifyVoxelView(input), "peripheral");
  assert.equal(
    classifyVoxelView({ ...input, previousClass: "forward" }),
    "forward",
  );
});

test("tree refinement keeps forward detail and coarsens peripheral and rear branches", () => {
  assert.ok(
    requestedLods(
      runSelection({ cameraForward: new THREE.Vector3(0, 1, 0) }),
    ).includes(1),
  );
  assert.ok(
    requestedLods(
      runSelection({ cameraForward: new THREE.Vector3(1, 0, 0) }),
    ).includes(2),
  );
  assert.equal(
    requestedLods(
      runSelection({ cameraForward: new THREE.Vector3(0, -1, 0) }),
    )[0],
    4,
  );
});

test("local focus overrides rear coarsening", () => {
  const lods = requestedLods(
    runSelection({
      cameraForward: new THREE.Vector3(0, -1, 0),
      focusPoint: new THREE.Vector3(64, 64, 0),
    }),
  );
  assert.ok(lods.includes(1));
});

test("missing child retains an eligible coarser fallback request", () => {
  const lods = requestedLods(
    runSelection({
      cameraForward: new THREE.Vector3(0, 1, 0),
      availableLods: [2, 4, 8, 16, 32],
    }),
  );
  assert.ok(lods.includes(2));
  assert.ok(!lods.includes(1));
});

test("screen-space scaling never removes render-distance root coverage", () => {
  const result = runSelection({
    cameraForward: new THREE.Vector3(0, 1, -0.5).normalize(),
    cameraPosition: new THREE.Vector3(64, -8_000, 6_000),
    availableLods: [32],
    screenSpaceDistanceScale: 2.5,
    renderDistance: 19_200,
  });

  assert.deepEqual(requestedLods(result), [32]);
});

test("warm-cached bounds keep unloaded root eligibility stable", () => {
  const key = voxelTileKey(4, 0, 0);
  const tile = {
    key,
    lod: 4,
    regionX: 0,
    regionY: 0,
    minZ: 10_000,
    maxZ: 10_100,
    chunkTopHeights: new Float32Array(16).fill(10_100),
    subMeshes: [],
    transparentSubMeshes: [],
  } as unknown as LoadedVoxelTile;

  const result = runSelection({
    cameraForward: new THREE.Vector3(0, 1, 0),
    cameraPosition: new THREE.Vector3(64, 64, 0),
    availableLods: [4],
    rootLod: 4,
    renderDistance: 1_000,
    warmCachedVoxels: new Map([[key, { tile, bytes: 1 }]]),
  });

  assert.equal(result.requestedVoxelRequests.size, 0);
});

test("stationary selection converges with retained per-key view classes", () => {
  const viewClasses = new Map<string, VoxelViewClass>();
  const first = runSelection({
    cameraForward: new THREE.Vector3(1, 0, 0),
    viewClasses,
  });
  const second = runSelection({
    cameraForward: new THREE.Vector3(1, 0, 0),
    viewClasses,
  });
  assert.deepEqual(
    [...second.requestedVoxelRequests.entries()],
    [...first.requestedVoxelRequests.entries()],
  );
});
