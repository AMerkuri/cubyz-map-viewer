import * as THREE from "three";
import { getLodBorderColor } from "./primitives.js";
import type { PendingVoxelMeshItem } from "./types.js";
import { chunkWorldSize, regionWorldSize } from "./utils.js";

export function buildVoxelBorderLines(
  regionX: number,
  regionY: number,
  lod: number,
  minZ: number,
  maxZ: number,
): THREE.LineSegments {
  const regionSize = regionWorldSize(lod);
  const chunkSize = chunkWorldSize(lod);
  const zMin = minZ;
  const zMax = maxZ + Math.max(1, lod);

  const verts: number[] = [];

  for (let i = 0; i <= 4; i++) {
    const gx = regionX + i * chunkSize;
    verts.push(gx, regionY, zMax, gx, regionY + regionSize, zMax);
  }

  for (let j = 0; j <= 4; j++) {
    const gy = regionY + j * chunkSize;
    verts.push(regionX, gy, zMax, regionX + regionSize, gy, zMax);
  }

  const corners: [number, number][] = [
    [regionX, regionY],
    [regionX + regionSize, regionY],
    [regionX, regionY + regionSize],
    [regionX + regionSize, regionY + regionSize],
  ];
  for (const [cx, cy] of corners) {
    verts.push(cx, cy, zMin, cx, cy, zMax);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(verts), 3),
  );
  const mat = new THREE.LineBasicMaterial({
    color: getLodBorderColor(lod).line,
    depthTest: true,
  });
  return new THREE.LineSegments(geom, mat);
}

export function buildVoxelQuadrantSubMeshes(
  item: PendingVoxelMeshItem,
  voxelMaterial: THREE.Material,
): {
  subMeshes: {
    quadrantIndex: number;
    mesh: THREE.Mesh;
    baseColors: Float32Array;
    faceAo: Uint8Array;
    aoBoundarySignature: string;
  }[];
  minZ: number;
  maxZ: number;
} {
  const subMeshes: {
    quadrantIndex: number;
    mesh: THREE.Mesh;
    baseColors: Float32Array;
    faceAo: Uint8Array;
    aoBoundarySignature: string;
  }[] = [];

  for (const quadrant of item.quadrantMeshes) {
    if (quadrant.indices.length === 0) continue;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute(
      "position",
      new THREE.BufferAttribute(quadrant.positions, 3),
    );
    geom.setAttribute("normal", new THREE.BufferAttribute(quadrant.normals, 3));
    geom.setAttribute(
      "color",
      new THREE.BufferAttribute(quadrant.baseColors.slice(), 3),
    );
    geom.setIndex(new THREE.BufferAttribute(quadrant.indices, 1));
    geom.computeBoundingBox();
    geom.computeBoundingSphere();

    const mesh = new THREE.Mesh(geom, voxelMaterial);
    subMeshes.push({
      quadrantIndex: quadrant.quadrantIndex,
      mesh,
      baseColors: quadrant.baseColors,
      faceAo: quadrant.faceAo,
      aoBoundarySignature: "",
    });
  }

  return { subMeshes, minZ: item.minZ, maxZ: item.maxZ };
}
