import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { updateKeyboardCameraMotion } from "../../../src/client/features/world-view/lib/camera.js";

function createCameraState() {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, -10, 10);
  const controls = { target: new THREE.Vector3() } as OrbitControls;
  return { camera, controls };
}

function getMovementDistance(keys: Set<string>): number {
  const { camera, controls } = createCameraState();
  const start = camera.position.clone();
  updateKeyboardCameraMotion(camera, controls, keys, 1 / 60);
  return camera.position.distanceTo(start);
}

test("Shift halves keyboard camera translation for either Shift key", () => {
  const normalDistance = getMovementDistance(new Set(["KeyW"]));
  const leftShiftDistance = getMovementDistance(new Set(["KeyW", "ShiftLeft"]));
  const rightShiftDistance = getMovementDistance(
    new Set(["KeyW", "ShiftRight"]),
  );

  assert.equal(normalDistance, 1);
  assert.equal(leftShiftDistance, normalDistance * 0.5);
  assert.equal(rightShiftDistance, normalDistance * 0.5);
});

test("Shift alone does not translate and does not alter Q/E rotation", () => {
  const shiftOnly = createCameraState();
  const shiftOnlyPosition = shiftOnly.camera.position.clone();
  const shiftOnlyTarget = shiftOnly.controls.target.clone();
  updateKeyboardCameraMotion(
    shiftOnly.camera,
    shiftOnly.controls,
    new Set(["ShiftLeft"]),
    1 / 60,
  );
  assert.deepEqual(shiftOnly.camera.position, shiftOnlyPosition);
  assert.deepEqual(shiftOnly.controls.target, shiftOnlyTarget);

  const normalRotation = createCameraState();
  const shiftRotation = createCameraState();
  updateKeyboardCameraMotion(
    normalRotation.camera,
    normalRotation.controls,
    new Set(["KeyQ"]),
    1 / 60,
  );
  updateKeyboardCameraMotion(
    shiftRotation.camera,
    shiftRotation.controls,
    new Set(["KeyQ", "ShiftRight"]),
    1 / 60,
  );
  assert.deepEqual(
    shiftRotation.camera.position,
    normalRotation.camera.position,
  );
  assert.deepEqual(
    shiftRotation.controls.target,
    normalRotation.controls.target,
  );
});
