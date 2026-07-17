import * as THREE from "three";
import { VOXEL_EMISSIVE_ATTRIBUTE } from "./block-light-mesh.js";
import { getLodBorderColor } from "./primitives.js";
import type {
  LoadedVoxelTile,
  PendingVoxelMeshItem,
  WorkerEnhancementQuadrant,
} from "./types.js";
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
  transparentVoxelMaterial: THREE.Material,
): {
  subMeshes: {
    quadrantIndex: number;
    mesh: THREE.Mesh;
    baseColors: Float32Array;
    faceAo: Uint8Array;
    trianglePaletteIndices: Uint32Array;
    aoBoundarySignature: string;
  }[];
  transparentSubMeshes: {
    quadrantIndex: number;
    mesh: THREE.Mesh;
    baseColors: Float32Array;
    faceAo: Uint8Array;
    trianglePaletteIndices: Uint32Array;
    aoBoundarySignature: string;
  }[];
  minZ: number;
  maxZ: number;
} {
  const buildSubMeshes = (
    quadrantMeshes: typeof item.quadrantMeshes,
    material: THREE.Material,
    renderOrder: number,
    retainBaseColors: boolean,
  ): {
    quadrantIndex: number;
    mesh: THREE.Mesh;
    baseColors: Float32Array;
    faceAo: Uint8Array;
    trianglePaletteIndices: Uint32Array;
    aoBoundarySignature: string;
  }[] => {
    const subMeshes: {
      quadrantIndex: number;
      mesh: THREE.Mesh;
      baseColors: Float32Array;
      faceAo: Uint8Array;
      trianglePaletteIndices: Uint32Array;
      aoBoundarySignature: string;
    }[] = [];

    for (const quadrant of quadrantMeshes) {
      if (quadrant.indices.length === 0) continue;
      const geom = new THREE.BufferGeometry();
      const colorAttributeArray = retainBaseColors
        ? quadrant.baseColors.slice()
        : quadrant.baseColors;
      geom.setAttribute(
        "position",
        new THREE.BufferAttribute(quadrant.positions, 3),
      );
      geom.setAttribute(
        "normal",
        new THREE.BufferAttribute(quadrant.normals, 3),
      );
      geom.setAttribute(
        "color",
        new THREE.BufferAttribute(colorAttributeArray, 3),
      );
      // Worker-baked mesh-local emitted light. Only opaque quadrants near
      // emitters carry the attribute; other meshes read the WebGL default
      // of (0,0,0) through the patched voxel material. The worker emits a
      // compact normalized integer array, so upload it with the normalized
      // flag to keep the shader reading vec3 values in the 0..1 range.
      if (quadrant.emissiveColors) {
        geom.setAttribute(
          VOXEL_EMISSIVE_ATTRIBUTE,
          new THREE.BufferAttribute(quadrant.emissiveColors, 3, true),
        );
      }
      geom.setIndex(new THREE.BufferAttribute(quadrant.indices, 1));
      geom.computeBoundingBox();
      geom.computeBoundingSphere();

      const mesh = new THREE.Mesh(geom, material);
      mesh.renderOrder = renderOrder;
      subMeshes.push({
        quadrantIndex: quadrant.quadrantIndex,
        mesh,
        baseColors: quadrant.baseColors,
        faceAo: quadrant.faceAo,
        trianglePaletteIndices: quadrant.trianglePaletteIndices,
        aoBoundarySignature: "",
      });
    }

    return subMeshes;
  };

  return {
    subMeshes: buildSubMeshes(item.quadrantMeshes, voxelMaterial, 0, true),
    transparentSubMeshes: buildSubMeshes(
      item.transparentQuadrantMeshes,
      transparentVoxelMaterial,
      1,
      false,
    ),
    minZ: item.minZ,
    maxZ: item.maxZ,
  };
}

export function attachVoxelEmissiveEnhancement(
  tile: LoadedVoxelTile,
  enhancements: readonly WorkerEnhancementQuadrant[],
): boolean {
  const attributes = new Map<number, THREE.BufferAttribute>();
  for (const enhancement of enhancements) {
    const subMesh = tile.subMeshes.find(
      (candidate) => candidate.quadrantIndex === enhancement.quadrantIndex,
    );
    if (!subMesh) return false;
    const position = subMesh.mesh.geometry.getAttribute("position");
    if (enhancement.emissiveColors.length !== position.count * 3) return false;
    attributes.set(
      enhancement.quadrantIndex,
      new THREE.BufferAttribute(enhancement.emissiveColors, 3, true),
    );
  }
  for (const subMesh of tile.subMeshes) {
    const attribute = attributes.get(subMesh.quadrantIndex);
    if (attribute) {
      subMesh.mesh.geometry.setAttribute(VOXEL_EMISSIVE_ATTRIBUTE, attribute);
    }
  }
  return true;
}
