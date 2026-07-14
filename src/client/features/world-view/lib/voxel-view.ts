import { LOD_LEVELS } from "./constants.js";
import type { VoxelViewClass } from "./voxel-work.js";

interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

export interface VoxelViewBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export function getReferenceVoxelViewBounds(args: {
  regionX: number;
  regionY: number;
  worldSize: number;
  referenceSurfaceZ: number;
}): VoxelViewBounds {
  const { regionX, regionY, worldSize, referenceSurfaceZ } = args;
  const verticalAllowance = worldSize / 2;
  return {
    minX: regionX,
    maxX: regionX + worldSize,
    minY: regionY,
    maxY: regionY + worldSize,
    minZ: referenceSurfaceZ - verticalAllowance,
    maxZ: referenceSurfaceZ + verticalAllowance,
  };
}

export function classifyVoxelView(args: {
  cameraPosition: Vector3Like;
  cameraDirection: Vector3Like;
  verticalFovDegrees: number;
  viewportAspect: number;
  bounds: VoxelViewBounds;
  enterMarginDegrees: number;
  exitMarginDegrees: number;
  previousClass?: VoxelViewClass;
}): VoxelViewClass {
  const {
    cameraPosition,
    cameraDirection,
    verticalFovDegrees,
    viewportAspect,
    bounds,
    enterMarginDegrees,
    exitMarginDegrees,
    previousClass,
  } = args;
  const directionLength = Math.hypot(
    cameraDirection.x,
    cameraDirection.y,
    cameraDirection.z,
  );
  if (directionLength <= 1e-6) return previousClass ?? "forward";

  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  const toCenterX = centerX - cameraPosition.x;
  const toCenterY = centerY - cameraPosition.y;
  const toCenterZ = centerZ - cameraPosition.z;
  const centerDistance = Math.hypot(toCenterX, toCenterY, toCenterZ);
  const radius = Math.hypot(
    (bounds.maxX - bounds.minX) / 2,
    (bounds.maxY - bounds.minY) / 2,
    (bounds.maxZ - bounds.minZ) / 2,
  );
  if (centerDistance <= radius || centerDistance <= 1e-6) return "forward";

  const dot = Math.max(
    -1,
    Math.min(
      1,
      (cameraDirection.x * toCenterX +
        cameraDirection.y * toCenterY +
        cameraDirection.z * toCenterZ) /
        (directionLength * centerDistance),
    ),
  );
  const centerAngle = (Math.acos(dot) * 180) / Math.PI;
  const boundsAngle =
    (Math.asin(Math.min(1, radius / centerDistance)) * 180) / Math.PI;
  const verticalHalfFov = Math.max(0, verticalFovDegrees) / 2;
  const horizontalHalfFov =
    (Math.atan(
      Math.tan((verticalHalfFov * Math.PI) / 180) * Math.max(0, viewportAspect),
    ) *
      180) /
    Math.PI;
  // A spherical cone around the frustum diagonal intentionally overestimates
  // visibility near edges so unloaded tiles are never classified too coarsely.
  const forwardBoundary =
    Math.hypot(verticalHalfFov, horizontalHalfFov) + boundsAngle;
  const enterMargin = Math.max(0, enterMarginDegrees);
  const exitMargin = Math.max(enterMargin, exitMarginDegrees);

  if (
    centerAngle <=
    forwardBoundary + (previousClass === "forward" ? exitMargin : enterMargin)
  ) {
    return "forward";
  }

  if (previousClass === "rear") {
    return centerAngle >= 90 - exitMargin - boundsAngle ? "rear" : "peripheral";
  }
  return centerAngle >= 90 + enterMargin + boundsAngle ? "rear" : "peripheral";
}

export function clampVoxelRefinementLod(
  desiredLod: number,
  viewClass: VoxelViewClass,
): number {
  if (viewClass === "focus" || viewClass === "forward") return desiredLod;
  const desiredIndex = LOD_LEVELS.indexOf(desiredLod);
  if (desiredIndex < 0) return desiredLod;
  const coarserLevels = viewClass === "peripheral" ? 1 : 2;
  return (
    LOD_LEVELS[Math.min(LOD_LEVELS.length - 1, desiredIndex + coarserLevels)] ??
    desiredLod
  );
}
