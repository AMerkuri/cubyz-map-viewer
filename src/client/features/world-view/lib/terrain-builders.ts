import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { TERRAIN_SKIRT_DEPTH } from "./constants.js";
import { createTextSprite, getLodBorderColor } from "./primitives.js";
import type { TerrainMeshData } from "./types.js";

export function buildFullTileMesh(
  data: TerrainMeshData,
  terrainMaterial: THREE.Material,
): THREE.Mesh {
  const worldTileSize = 256 * data.voxelSize;
  const visibleSegmentWidth = data.meshWidth - 1;
  const visibleSegmentHeight = data.meshHeight - 1;

  const geometry = new THREE.PlaneGeometry(
    worldTileSize,
    worldTileSize,
    visibleSegmentWidth,
    visibleSegmentHeight,
  );

  const positions = geometry.attributes.position;
  const colorAttr = new Float32Array(positions.count * 3);
  const normalAttr = new Float32Array(positions.count * 3);

  const edgeTop: {
    x: number;
    y: number;
    z: number;
    r: number;
    g: number;
    b: number;
  }[] = [];
  const edgeBottom: {
    x: number;
    y: number;
    z: number;
    r: number;
    g: number;
    b: number;
  }[] = [];
  const edgeLeft: {
    x: number;
    y: number;
    z: number;
    r: number;
    g: number;
    b: number;
  }[] = [];
  const edgeRight: {
    x: number;
    y: number;
    z: number;
    r: number;
    g: number;
    b: number;
  }[] = [];

  for (let i = 0; i < positions.count; i++) {
    const col = i % data.meshWidth;
    const row = Math.floor(i / data.meshWidth);
    // PlaneGeometry emits rows from +Y to -Y, so reverse the sampled row to
    // keep scene Y aligned with increasing world Y.
    const sampleX = col + data.gutter;
    const sampleY = data.sampleHeight - data.gutter - 1 - row;
    const dataIdx = sampleIndex(data, sampleX, sampleY);

    const ht = data.heights[dataIdx] ?? 0;
    positions.setZ(i, ht);

    const r = (data.colors[dataIdx * 3] ?? 128) / 255;
    const g = (data.colors[dataIdx * 3 + 1] ?? 128) / 255;
    const b = (data.colors[dataIdx * 3 + 2] ?? 128) / 255;

    colorAttr[i * 3] = r;
    colorAttr[i * 3 + 1] = g;
    colorAttr[i * 3 + 2] = b;

    const normal = computeSurfaceNormal(data, sampleX, sampleY);
    normalAttr[i * 3] = normal.x;
    normalAttr[i * 3 + 1] = normal.y;
    normalAttr[i * 3 + 2] = normal.z;

    const px = positions.getX(i);
    const py = positions.getY(i);
    const v = { x: px, y: py, z: ht, r, g, b };
    if (row === 0) edgeTop.push(v);
    if (row === data.meshHeight - 1) edgeBottom.push(v);
    if (col === 0) edgeLeft.push(v);
    if (col === data.meshWidth - 1) edgeRight.push(v);
  }

  geometry.setAttribute("color", new THREE.BufferAttribute(colorAttr, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normalAttr, 3));
  geometry.deleteAttribute("uv");

  const skirtPositions: number[] = [];
  const skirtColors: number[] = [];
  const skirtIndices: number[] = [];
  const skirtNormals: number[] = [];

  function addSkirtStrip(
    edge: {
      x: number;
      y: number;
      z: number;
      r: number;
      g: number;
      b: number;
    }[],
  ) {
    for (let j = 0; j < edge.length - 1; j++) {
      const a = edge[j];
      const b = edge[j + 1];
      const base = skirtPositions.length / 3;
      skirtPositions.push(
        a.x,
        a.y,
        a.z,
        b.x,
        b.y,
        b.z,
        b.x,
        b.y,
        b.z - TERRAIN_SKIRT_DEPTH,
        a.x,
        a.y,
        a.z - TERRAIN_SKIRT_DEPTH,
      );
      skirtColors.push(
        a.r,
        a.g,
        a.b,
        b.r,
        b.g,
        b.b,
        b.r,
        b.g,
        b.b,
        a.r,
        a.g,
        a.b,
      );
      const edgeDir = new THREE.Vector2(b.x - a.x, b.y - a.y);
      if (edgeDir.lengthSq() > 0) {
        edgeDir.normalize();
      }
      const outward = new THREE.Vector3(edgeDir.y, -edgeDir.x, 0);
      for (let k = 0; k < 4; k++) {
        skirtNormals.push(outward.x, outward.y, outward.z);
      }
      skirtIndices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  addSkirtStrip(edgeTop);
  addSkirtStrip(edgeBottom);
  addSkirtStrip(edgeLeft);
  addSkirtStrip(edgeRight);

  const skirtGeom = new THREE.BufferGeometry();
  skirtGeom.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(skirtPositions), 3),
  );
  skirtGeom.setAttribute(
    "color",
    new THREE.BufferAttribute(new Float32Array(skirtColors), 3),
  );
  skirtGeom.setAttribute(
    "normal",
    new THREE.BufferAttribute(new Float32Array(skirtNormals), 3),
  );
  skirtGeom.setIndex(
    new THREE.BufferAttribute(new Uint32Array(skirtIndices), 1),
  );

  const merged = mergeGeometries([geometry, skirtGeom]);
  skirtGeom.dispose();
  geometry.dispose();

  merged.computeBoundingBox();
  merged.computeBoundingSphere();

  const mesh = new THREE.Mesh(merged, terrainMaterial);
  const centerX = data.worldX + worldTileSize / 2;
  const centerY = data.worldY + worldTileSize / 2;
  mesh.position.set(centerX, centerY, 0);
  return mesh;
}

function sampleIndex(
  data: TerrainMeshData,
  sampleX: number,
  sampleY: number,
): number {
  return sampleX * data.sampleHeight + sampleY;
}

function sampleHeight(
  data: TerrainMeshData,
  sampleX: number,
  sampleY: number,
): number {
  const clampedX = THREE.MathUtils.clamp(sampleX, 0, data.sampleWidth - 1);
  const clampedY = THREE.MathUtils.clamp(sampleY, 0, data.sampleHeight - 1);
  return data.heights[sampleIndex(data, clampedX, clampedY)] ?? 0;
}

function computeSurfaceNormal(
  data: TerrainMeshData,
  sampleX: number,
  sampleY: number,
): THREE.Vector3 {
  const dx = data.stepWorld;
  const dy = data.stepWorld;
  const left = sampleHeight(data, sampleX - 1, sampleY);
  const right = sampleHeight(data, sampleX + 1, sampleY);
  const down = sampleHeight(data, sampleX, sampleY - 1);
  const up = sampleHeight(data, sampleX, sampleY + 1);

  return new THREE.Vector3(
    left - right,
    down - up,
    2 * Math.max(dx, dy),
  ).normalize();
}

export function buildSurfaceTileBorderLines(
  worldX: number,
  worldY: number,
  lod: number,
  mesh: THREE.Mesh,
): { lines: THREE.LineSegments; label: THREE.Sprite } {
  const colors = getLodBorderColor(lod);
  const size = 256 * lod;
  const z = (mesh.geometry.boundingBox?.max.z ?? 0) + 2;

  const verts = new Float32Array([
    worldX,
    worldY,
    z,
    worldX + size,
    worldY,
    z,
    worldX + size,
    worldY,
    z,
    worldX + size,
    worldY + size,
    z,
    worldX + size,
    worldY + size,
    z,
    worldX,
    worldY + size,
    z,
    worldX,
    worldY + size,
    z,
    worldX,
    worldY,
    z,
  ]);

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  const mat = new THREE.LineBasicMaterial({
    color: colors.line,
    depthTest: true,
  });
  const lines = new THREE.LineSegments(geom, mat);

  const label = createTextSprite(`LOD ${lod}`, colors.label);
  label.scale.set(48, 12, 1);
  label.position.set(worldX + size / 2, worldY + size / 2, z + 6);
  return { lines, label };
}
