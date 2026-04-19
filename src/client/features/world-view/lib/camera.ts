import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";

import {
  DEFAULT_START_OFFSET_Y,
  DEFAULT_START_OFFSET_Z,
  INITIAL_CAMERA_ZOOM,
} from "./constants.js";
import type { InitialCameraState } from "./types.js";
import { worldToScene } from "./utils.js";

const PLAYER_FOCUS_CLEARANCE_Z = 16;
const PLAYER_FOCUS_RAYCAST_START_Z = 10_000;

function getSpawnFallbackSurfaceZ(worldPos: [number, number, number]): number {
  return worldPos[2] + PLAYER_FOCUS_CLEARANCE_Z;
}

export function focusCameraOnWorldPosition(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  worldPos: [number, number, number],
): void {
  const [sx, sy, sz] = worldToScene(worldPos[0], worldPos[1], worldPos[2]);
  const offset = camera.position.clone().sub(controls.target);
  controls.target.set(sx, sy, sz);
  camera.position.copy(controls.target).add(offset);
  controls.update();
}

export function focusCameraOnVisibleSurfacePosition(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  worldPos: [number, number, number],
  terrainGroup: THREE.Object3D | null,
  voxelGroup: THREE.Object3D | null,
): void {
  const [sx, sy] = worldToScene(worldPos[0], worldPos[1], worldPos[2]);
  const offset = camera.position.clone().sub(controls.target);
  const surfaceZ = findVisibleSurfaceZAtWorldPosition({
    camera,
    controls,
    worldX: sx,
    worldY: sy,
    terrainGroup,
    voxelGroup,
  });
  const targetZ = surfaceZ ?? getSpawnFallbackSurfaceZ(worldPos);

  controls.target.set(sx, sy, targetZ);
  camera.position.copy(controls.target).add(offset);
  controls.update();
}

export function panCameraToWorldPosition(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  worldPos: [number, number, number],
  terrainGroup: THREE.Object3D | null,
  voxelGroup: THREE.Object3D | null,
): void {
  const [sx, sy] = worldToScene(worldPos[0], worldPos[1], worldPos[2]);
  const offset = camera.position.clone().sub(controls.target);

  const target = controls.target.clone();
  target.set(sx, sy, target.z);

  const cameraPos = target.clone().add(offset);
  const surfaceZ = findVisibleSurfaceZAtWorldPosition({
    camera,
    controls,
    worldX: sx,
    worldY: sy,
    terrainGroup,
    voxelGroup,
  });

  if (surfaceZ !== null && cameraPos.z < surfaceZ + PLAYER_FOCUS_CLEARANCE_Z) {
    const lift = surfaceZ + PLAYER_FOCUS_CLEARANCE_Z - cameraPos.z;
    target.z += lift;
    cameraPos.z += lift;
  }

  controls.target.copy(target);
  camera.position.copy(cameraPos);
  controls.update();
}

function findVisibleSurfaceZAtWorldPosition(args: {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  worldX: number;
  worldY: number;
  terrainGroup: THREE.Object3D | null;
  voxelGroup: THREE.Object3D | null;
}): number | null {
  const { camera, controls, worldX, worldY, terrainGroup, voxelGroup } = args;
  const raycaster = new THREE.Raycaster();
  raycaster.ray.origin.set(
    worldX,
    worldY,
    Math.max(camera.position.z, controls.target.z) +
      PLAYER_FOCUS_RAYCAST_START_Z,
  );
  raycaster.ray.direction.set(0, 0, -1);

  const intersections = raycaster.intersectObjects(
    [terrainGroup, voxelGroup].filter(
      (group): group is THREE.Object3D => group !== null,
    ),
    true,
  );

  return intersections[0]?.point.z ?? null;
}

export function applyInitialCameraState(args: {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  initialCameraState: InitialCameraState | null;
  spawn: [number, number, number] | null | undefined;
  terrainGroup: THREE.Object3D | null;
  voxelGroup: THREE.Object3D | null;
}): void {
  const {
    camera,
    controls,
    initialCameraState,
    spawn,
    terrainGroup,
    voxelGroup,
  } = args;

  if (initialCameraState) {
    const { pos, zoom, theta, phi } = initialCameraState;
    const [stx, sty, stz] = worldToScene(pos[0], pos[1], pos[2]);
    const clampedZoom = THREE.MathUtils.clamp(
      zoom,
      controls.minDistance,
      controls.maxDistance,
    );
    controls.target.set(stx, sty, stz);
    const thetaRad = THREE.MathUtils.degToRad(theta);
    const phiRad = THREE.MathUtils.degToRad(Math.min(phi, 88));
    const dx = clampedZoom * Math.sin(phiRad) * Math.cos(thetaRad);
    const dy = clampedZoom * Math.sin(phiRad) * Math.sin(thetaRad);
    const dz = clampedZoom * Math.cos(phiRad);
    camera.position.set(stx + dx, sty + dy, stz + dz);
    controls.update();
    return;
  }

  if (!spawn) return;

  const [sx, sy] = worldToScene(spawn[0], spawn[1], spawn[2]);
  const baseZoom = Math.hypot(DEFAULT_START_OFFSET_Y, DEFAULT_START_OFFSET_Z);
  const zoomScale = INITIAL_CAMERA_ZOOM / baseZoom;
  const surfaceZ = findVisibleSurfaceZAtWorldPosition({
    camera,
    controls,
    worldX: sx,
    worldY: sy,
    terrainGroup,
    voxelGroup,
  });
  const targetZ = surfaceZ ?? getSpawnFallbackSurfaceZ(spawn);
  camera.position.set(
    sx,
    sy - DEFAULT_START_OFFSET_Y * zoomScale,
    targetZ + DEFAULT_START_OFFSET_Z * zoomScale,
  );
  controls.target.set(sx, sy, targetZ);
  controls.update();
}

export function updateKeyboardCameraMotion(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  keys: Set<string>,
  deltaSeconds: number,
): void {
  if (keys.size === 0) return;

  const dist = camera.position.distanceTo(controls.target);
  const frameScale = deltaSeconds * 60;
  const speed = Math.max(1, dist * 0.015) * frameScale;

  const fwdX = controls.target.x - camera.position.x;
  const fwdY = controls.target.y - camera.position.y;
  const fwdLen = Math.sqrt(fwdX * fwdX + fwdY * fwdY);

  let moveX = 0;
  let moveY = 0;

  if (fwdLen > 0.001) {
    const fx = fwdX / fwdLen;
    const fy = fwdY / fwdLen;
    const rx = fy;
    const ry = -fx;

    if (keys.has("KeyW") || keys.has("ArrowUp")) {
      moveX += fx;
      moveY += fy;
    }
    if (keys.has("KeyS") || keys.has("ArrowDown")) {
      moveX -= fx;
      moveY -= fy;
    }
    if (keys.has("KeyA") || keys.has("ArrowLeft")) {
      moveX -= rx;
      moveY -= ry;
    }
    if (keys.has("KeyD") || keys.has("ArrowRight")) {
      moveX += rx;
      moveY += ry;
    }
  } else {
    if (keys.has("KeyW") || keys.has("ArrowUp")) moveY += 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) moveY -= 1;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) moveX -= 1;
    if (keys.has("KeyD") || keys.has("ArrowRight")) moveX += 1;
  }

  if (moveX !== 0 || moveY !== 0) {
    const len = Math.sqrt(moveX * moveX + moveY * moveY);
    const dx = (moveX / len) * speed;
    const dy = (moveY / len) * speed;
    camera.position.x += dx;
    camera.position.y += dy;
    controls.target.x += dx;
    controls.target.y += dy;
  }

  let rotateDir = 0;
  if (keys.has("KeyQ")) rotateDir -= 1;
  if (keys.has("KeyE")) rotateDir += 1;
  if (rotateDir !== 0) {
    const offset = camera.position.clone().sub(controls.target);
    offset.applyAxisAngle(
      new THREE.Vector3(0, 0, 1),
      rotateDir * 0.025 * frameScale,
    );
    camera.position.copy(controls.target).add(offset);
  }
}
