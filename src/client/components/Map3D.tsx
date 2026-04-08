import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import type { useWorldData } from "../hooks/useWorldData.js";
import type { PlayerData } from "../hooks/usePlayers.js";
import type { TerrainUpdatesBatchEvent, WatchEvent, WatchEventType } from "../hooks/useWebSocket.js";
import type { SurfaceIndexEntry } from "../hooks/useWorldData.js";

interface TerrainMeshData {
  width: number;
  height: number;
  heights: number[];
  colors: number[];
  worldX: number;
  worldY: number;
  voxelSize: number;
  minHeight: number;
  maxHeight: number;
}

interface BiomesResponse {
  tileX: number;
  tileY: number;
  lod: number;
  regions: {
    biomeName: string;
    centerX: number;
    centerY: number;
    count: number;
  }[];
}

interface PendingVoxelMeshItem {
  key: string;
  lod: number;
  regionX: number;
  regionY: number;
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  chunkCoverage: number;
  chunkTopHeights: Float32Array;
  voxelSize: number;
}

interface WorkerOut {
  lod?: number;
  regionX: number;
  regionY: number;
  positions?: Float32Array;
  normals?: Float32Array;
  colors?: Float32Array;
  indices?: Uint32Array;
  chunkCoverage?: number;
  chunkTopHeights?: Float32Array;
  voxelSize?: number;
  error?: string;
}

interface LoadedTerrainTile {
  key: string;
  lod: number;
  tileX: number;
  tileY: number;
  worldX: number;
  worldY: number;
  mesh: THREE.Mesh;
  borderLines: THREE.LineSegments;
  borderLabel: THREE.Sprite;
}

interface LoadedVoxelTile {
  key: string;
  lod: number;
  regionX: number;
  regionY: number;
  voxelSize: number;
  subMeshes: {
    colIndex: number;
    worldX: number;
    worldY: number;
    mesh: THREE.Mesh;
  }[];
  minZ: number;
  maxZ: number;
  chunkCoverage: number;
  chunkTopHeights: Float32Array;
  borderLines: THREE.LineSegments;
}

export interface InitialCameraState {
  pos: [number, number, number];
  zoom: number;
  theta: number;
  phi: number;
}

interface Map3DProps {
  mode: "terrain" | "voxel";
  worldData: ReturnType<typeof useWorldData>;
  players: PlayerData[];
  subscribe: (type: WatchEventType, handler: (event: WatchEvent) => void) => () => void;
  showPlayers: boolean;
  showSpawn: boolean;
  showChunkBorders: boolean;
  showTerrain: boolean;
  showBiomeLabels: boolean;
  showVoxelHeightLabels: boolean;
  onCursorMove: (pos: [number, number, number] | null) => void;
  onChunkStatsChange: (stats: {
    loading: number;
    loaded: number;
    fps: number;
    focusLod: number;
    mode: "terrain" | "voxel";
    loadingBreakdown: {
      terrain: number;
      voxels: number;
      fetchQueue: number;
      meshQueue: number;
    };
    voxelHealth: {
      missing: number;
      failed: number;
    };
    loadedByLod: Partial<Record<1 | 2 | 4 | 8 | 16 | 32, number>>;
  }) => void;
  initialCameraState: InitialCameraState | null;
  onShareStateChange: (state: { mode: "terrain" | "voxel"; pos: [number, number, number]; zoom: number; theta: number; phi: number }) => void;
  flyToRequest: { pos: [number, number, number]; key: number } | null;
}

const LOD_LEVELS = [1, 2, 4, 8, 16, 32];

const LOD_BORDER_COLORS: Record<number, { line: number; label: string }> = {
  1: { line: 0x44ff66, label: "#44ff66" },
  2: { line: 0x88ff44, label: "#88ff44" },
  4: { line: 0xffdd44, label: "#ffdd44" },
  8: { line: 0xffaa33, label: "#ffaa33" },
  16: { line: 0xff6633, label: "#ff6633" },
  32: { line: 0xff3344, label: "#ff3344" },
};

const LOD_DISTANCE_THRESHOLDS = [
  { maxDist: 600, lod: 1 },
  { maxDist: 1200, lod: 2 },
  { maxDist: 2400, lod: 4 },
  { maxDist: 4800, lod: 8 },
  { maxDist: 9600, lod: 16 },
  { maxDist: Infinity, lod: 32 },
];

const LOD_UNLOAD_HYSTERESIS = 1.5;
const MAX_CONCURRENT_VOXEL_FETCHES = 8;
const MAX_VOXEL_RETRIES = 2;
const TERRAIN_RENDER_RADIUS_SCALE = LOD_UNLOAD_HYSTERESIS * 2.25;
const TERRAIN_MAX_LOD_UNLOAD_DIST = (LOD_DISTANCE_THRESHOLDS[LOD_DISTANCE_THRESHOLDS.length - 2]?.maxDist ?? 9600)
  * TERRAIN_RENDER_RADIUS_SCALE * 1.2;
const INITIAL_CAMERA_ZOOM = 1300;
const DEFAULT_START_OFFSET_Y = 400;
const DEFAULT_START_OFFSET_Z = 300;

const VOXEL_REGION_CELLS = 128;
const VOXEL_CHUNK_CELLS = 32;
const TERRAIN_SKIRT_DEPTH = 32;
const MAX_BIOME_LABELS = 120;

const terrainMaterial = new THREE.MeshLambertMaterial({
  vertexColors: true,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1,
});

const voxelMaterial = new THREE.MeshLambertMaterial({
  vertexColors: true,
  side: THREE.FrontSide,
});

function worldToScene(worldX: number, worldY: number, worldZ: number): [number, number, number] {
  return [worldX, -worldY, worldZ];
}

function getLodForDistance(dist: number): number {
  for (const threshold of LOD_DISTANCE_THRESHOLDS) {
    if (dist <= threshold.maxDist) return threshold.lod;
  }
  return 32;
}

function getUnloadDistForLod(lod: number): number {
  const entry = LOD_DISTANCE_THRESHOLDS.find((t) => t.lod === lod);
  if (!entry || entry.maxDist === Infinity) return Infinity;
  return entry.maxDist * LOD_UNLOAD_HYSTERESIS;
}

function getTerrainLodForDistance(dist: number): number {
  return getLodForDistance(dist / TERRAIN_RENDER_RADIUS_SCALE);
}

function getTerrainUnloadDistForLod(lod: number): number {
  const unloadDist = getUnloadDistForLod(lod);
  if (!Number.isFinite(unloadDist)) return TERRAIN_MAX_LOD_UNLOAD_DIST;
  return unloadDist * TERRAIN_RENDER_RADIUS_SCALE;
}

function getLodBorderColor(lod: number): { line: number; label: string } {
  return LOD_BORDER_COLORS[lod] ?? { line: 0xffffff, label: "#ffffff" };
}

function createTextSprite(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    const texture = new THREE.CanvasTexture(canvas);
    return new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  }
  ctx.font = "bold 28px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.fillText(text, 130, 34);
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 32);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(60, 15, 1);
  return sprite;
}

function createMarkerDot(color: string, sizePx: number): CSS2DObject {
  const div = document.createElement("div");
  div.style.cssText = [
    `width: ${sizePx}px`,
    `height: ${sizePx}px`,
    "border-radius: 999px",
    `background: ${color}`,
    "border: 1px solid rgba(255,255,255,0.75)",
    "box-shadow: 0 0 8px rgba(0,0,0,0.55)",
    "pointer-events: none",
  ].join(";");
  return new CSS2DObject(div);
}

function createMarkerLabel(text: string, color: string): CSS2DObject {
  const div = document.createElement("div");
  div.textContent = text;
  div.style.cssText = [
    `color: ${color}`,
    "font-size: 20px",
    "font-weight: 700",
    "text-shadow: 0 0 4px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.55)",
    "pointer-events: none",
    "white-space: nowrap",
  ].join(";");
  return new CSS2DObject(div);
}

function disposeTextSprite(sprite: THREE.Sprite) {
  const mat = sprite.material as THREE.SpriteMaterial;
  mat.map?.dispose();
  mat.dispose();
}

function regionWorldSize(lod: number): number {
  return VOXEL_REGION_CELLS * lod;
}

function chunkWorldSize(lod: number): number {
  return VOXEL_CHUNK_CELLS * lod;
}

function formatHeight(value: number): string {
  if (!Number.isFinite(value)) return "n/a";
  return value.toFixed(1);
}

function countBits16(v: number): number {
  let n = v & 0xffff;
  let c = 0;
  while (n) {
    n &= n - 1;
    c++;
  }
  return c;
}

function formatBiomeName(biomeId: string): string {
  const name = biomeId.includes(":") ? biomeId.split(":")[1] : biomeId;
  const parts = name.split(/[/_]/).filter(Boolean);
  return parts
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .reverse()
    .join(" ");
}

function cleanPlayerName(name: string): string {
  return name.replace(/[*]{1,3}|#[0-9A-Fa-f]{6}/g, "").trim() || "Player";
}

function buildFullTileMesh(data: TerrainMeshData): THREE.Mesh {
  const worldTileSize = 256 * data.voxelSize;

  const geometry = new THREE.PlaneGeometry(
    worldTileSize,
    worldTileSize,
    data.width - 1,
    data.height - 1,
  );

  const positions = geometry.attributes.position;
  const colorAttr = new Float32Array(positions.count * 3);

  const edgeTop: { x: number; y: number; z: number; r: number; g: number; b: number }[] = [];
  const edgeBottom: { x: number; y: number; z: number; r: number; g: number; b: number }[] = [];
  const edgeLeft: { x: number; y: number; z: number; r: number; g: number; b: number }[] = [];
  const edgeRight: { x: number; y: number; z: number; r: number; g: number; b: number }[] = [];

  for (let i = 0; i < positions.count; i++) {
    const col = i % data.width;
    const row = Math.floor(i / data.width);
    const dataIdx = col * data.height + row;

    const ht = data.heights[dataIdx] ?? 0;
    positions.setZ(i, ht);

    const r = (data.colors[dataIdx * 3] ?? 128) / 255;
    const g2 = (data.colors[dataIdx * 3 + 1] ?? 128) / 255;
    const b2 = (data.colors[dataIdx * 3 + 2] ?? 128) / 255;

    colorAttr[i * 3] = r;
    colorAttr[i * 3 + 1] = g2;
    colorAttr[i * 3 + 2] = b2;

    const px = positions.getX(i);
    const py = positions.getY(i);
    const v = { x: px, y: py, z: ht, r, g: g2, b: b2 };
    if (row === 0) edgeTop.push(v);
    if (row === data.height - 1) edgeBottom.push(v);
    if (col === 0) edgeLeft.push(v);
    if (col === data.width - 1) edgeRight.push(v);
  }

  geometry.setAttribute("color", new THREE.BufferAttribute(colorAttr, 3));
  geometry.deleteAttribute("uv");
  geometry.deleteAttribute("normal");

  const skirtPositions: number[] = [];
  const skirtColors: number[] = [];
  const skirtIndices: number[] = [];

  function addSkirtStrip(edge: { x: number; y: number; z: number; r: number; g: number; b: number }[]) {
    for (let j = 0; j < edge.length - 1; j++) {
      const a = edge[j];
      const b3 = edge[j + 1];
      const base = skirtPositions.length / 3;
      skirtPositions.push(
        a.x, a.y, a.z,
        b3.x, b3.y, b3.z,
        b3.x, b3.y, b3.z - TERRAIN_SKIRT_DEPTH,
        a.x, a.y, a.z - TERRAIN_SKIRT_DEPTH,
      );
      skirtColors.push(a.r, a.g, a.b, b3.r, b3.g, b3.b, b3.r, b3.g, b3.b, a.r, a.g, a.b);
      skirtIndices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  addSkirtStrip(edgeTop);
  addSkirtStrip(edgeBottom);
  addSkirtStrip(edgeLeft);
  addSkirtStrip(edgeRight);

  const skirtGeom = new THREE.BufferGeometry();
  skirtGeom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(skirtPositions), 3));
  skirtGeom.setAttribute("color", new THREE.BufferAttribute(new Float32Array(skirtColors), 3));
  skirtGeom.setIndex(new THREE.BufferAttribute(new Uint32Array(skirtIndices), 1));

  const merged = mergeGeometries([geometry, skirtGeom]);
  skirtGeom.dispose();
  geometry.dispose();

  merged.computeVertexNormals();
  merged.computeBoundingBox();
  merged.computeBoundingSphere();

  const mesh = new THREE.Mesh(merged, terrainMaterial);
  const centerX = data.worldX + worldTileSize / 2;
  const centerY = -(data.worldY + worldTileSize / 2);
  mesh.position.set(centerX, centerY, 0);
  return mesh;
}

function buildSurfaceTileBorderLines(worldX: number, worldY: number, lod: number, mesh: THREE.Mesh): { lines: THREE.LineSegments; label: THREE.Sprite } {
  const colors = getLodBorderColor(lod);
  const size = 256 * lod;
  const z = (mesh.geometry.boundingBox?.max.z ?? 0) + 2;

  const verts = new Float32Array([
    worldX, -worldY, z,
    worldX + size, -worldY, z,
    worldX + size, -worldY, z,
    worldX + size, -(worldY + size), z,
    worldX + size, -(worldY + size), z,
    worldX, -(worldY + size), z,
    worldX, -(worldY + size), z,
    worldX, -worldY, z,
  ]);

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  const mat = new THREE.LineBasicMaterial({ color: colors.line, depthTest: true });
  const lines = new THREE.LineSegments(geom, mat);

  const label = createTextSprite(`LOD ${lod}`, colors.label);
  label.scale.set(48, 12, 1);
  label.position.set(worldX + size / 2, -(worldY + size / 2), z + 6);
  return { lines, label };
}

function buildVoxelBorderLines(regionX: number, regionY: number, lod: number, minZ: number, maxZ: number): THREE.LineSegments {
  const regionSize = regionWorldSize(lod);
  const chunkSize = chunkWorldSize(lod);
  const zMin = minZ;
  const zMax = maxZ + Math.max(1, lod);

  const verts: number[] = [];

  for (let i = 0; i <= 4; i++) {
    const gx = regionX + i * chunkSize;
    verts.push(
      gx, -regionY, zMax,
      gx, -(regionY + regionSize), zMax,
    );
  }

  for (let j = 0; j <= 4; j++) {
    const gy = -(regionY + j * chunkSize);
    verts.push(
      regionX, gy, zMax,
      regionX + regionSize, gy, zMax,
    );
  }

  const corners: [number, number][] = [
    [regionX, -regionY],
    [regionX + regionSize, -regionY],
    [regionX, -(regionY + regionSize)],
    [regionX + regionSize, -(regionY + regionSize)],
  ];
  for (const [cx, cy] of corners) {
    verts.push(cx, cy, zMin, cx, cy, zMax);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(verts), 3));
  const mat = new THREE.LineBasicMaterial({ color: getLodBorderColor(lod).line, depthTest: true });
  return new THREE.LineSegments(geom, mat);
}

function buildVoxelColumnSubMeshes(item: PendingVoxelMeshItem): {
  subMeshes: {
    colIndex: number;
    worldX: number;
    worldY: number;
    mesh: THREE.Mesh;
  }[];
  minZ: number;
  maxZ: number;
} {
  const { positions, normals, colors, indices, lod, regionX, regionY } = item;
  const chunkSize = chunkWorldSize(lod);

  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let i = 2; i < positions.length; i += 3) {
    const z = positions[i];
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  if (!Number.isFinite(minZ)) minZ = 0;
  if (!Number.isFinite(maxZ)) maxZ = 0;

  const trisByCol: number[][] = Array.from({ length: 16 }, () => []);

  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i];
    const ib = indices[i + 1];
    const ic = indices[i + 2];

    const ax = positions[ia * 3];
    const ay = positions[ia * 3 + 1];
    const bx = positions[ib * 3];
    const by = positions[ib * 3 + 1];
    const cx = positions[ic * 3];
    const cy = positions[ic * 3 + 1];

    const centerX = (ax + bx + cx) / 3;
    const centerYWorld = (-(ay + by + cy)) / 3;

    const localX = centerX - regionX;
    const localY = centerYWorld - regionY;

    const colX = Math.floor(localX / chunkSize);
    const colY = Math.floor(localY / chunkSize);
    if (colX < 0 || colX > 3 || colY < 0 || colY > 3) continue;

    const colIndex = colX * 4 + colY;
    trisByCol[colIndex].push(ia, ib, ic);
  }

  const subMeshes: {
    colIndex: number;
    worldX: number;
    worldY: number;
    mesh: THREE.Mesh;
  }[] = [];

  for (let colIndex = 0; colIndex < 16; colIndex++) {
    const tri = trisByCol[colIndex];
    if (tri.length === 0) continue;

    const indexMap = new Map<number, number>();
    const localPos: number[] = [];
    const localNorm: number[] = [];
    const localCol: number[] = [];
    const localIdx: number[] = [];

    for (let j = 0; j < tri.length; j++) {
      const src = tri[j];
      let dst = indexMap.get(src);
      if (dst === undefined) {
        dst = indexMap.size;
        indexMap.set(src, dst);
        localPos.push(
          positions[src * 3],
          positions[src * 3 + 1],
          positions[src * 3 + 2],
        );
        localNorm.push(
          normals[src * 3],
          normals[src * 3 + 1],
          normals[src * 3 + 2],
        );
        localCol.push(
          colors[src * 3],
          colors[src * 3 + 1],
          colors[src * 3 + 2],
        );
      }
      localIdx.push(dst);
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(localPos), 3));
    geom.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(localNorm), 3));
    geom.setAttribute("color", new THREE.BufferAttribute(new Float32Array(localCol), 3));
    geom.setIndex(new THREE.BufferAttribute(new Uint32Array(localIdx), 1));
    geom.computeBoundingBox();
    geom.computeBoundingSphere();

    const mesh = new THREE.Mesh(geom, voxelMaterial);
    const colX = Math.floor(colIndex / 4);
    const colY = colIndex % 4;
    subMeshes.push({
      colIndex,
      worldX: regionX + colX * chunkSize,
      worldY: regionY + colY * chunkSize,
      mesh,
    });
  }

  return { subMeshes, minZ, maxZ };
}

function parseVoxelKey(key: string): { lod: number; regionX: number; regionY: number } | null {
  const parts = key.split("/");
  if (parts.length !== 3) return null;
  const lod = parseInt(parts[0]);
  const regionX = parseInt(parts[1]);
  const regionY = parseInt(parts[2]);
  if (isNaN(lod) || isNaN(regionX) || isNaN(regionY)) return null;
  return { lod, regionX, regionY };
}

export function Map3D({
  mode,
  worldData,
  players,
  subscribe,
  showPlayers,
  showSpawn,
  showChunkBorders,
  showTerrain,
  showBiomeLabels,
  showVoxelHeightLabels,
  onCursorMove,
  onChunkStatsChange,
  initialCameraState,
  onShareStateChange,
  flyToRequest,
}: Map3DProps) {
  const queryClient = useQueryClient();
  const queryClientRef = useRef<QueryClient>(queryClient);
  queryClientRef.current = queryClient;

  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    animFrameId: number;
  } | null>(null);

  const initializedRef = useRef(false);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const terrainGroupRef = useRef<THREE.Group | null>(null);
  const voxelGroupRef = useRef<THREE.Group | null>(null);
  const markerGroupRef = useRef<THREE.Group | null>(null);
  const spawnGroupRef = useRef<THREE.Group | null>(null);
  const chunkBorderGroupRef = useRef<THREE.Group | null>(null);

  const labelRendererRef = useRef<CSS2DRenderer | null>(null);
  const debugLabelGroupRef = useRef<THREE.Group | null>(null);
  const biomeLabelGroupRef = useRef<THREE.Group | null>(null);
  const debugLabelMapRef = useRef<Map<string, CSS2DObject>>(new Map());
  const biomeLabelMapRef = useRef<Map<string, CSS2DObject>>(new Map());

  const loadedTerrainRef = useRef<Map<string, LoadedTerrainTile>>(new Map());
  const loadingTerrainRef = useRef<Set<string>>(new Set());

  const loadedVoxelsRef = useRef<Map<string, LoadedVoxelTile>>(new Map());
  const loadingVoxelsRef = useRef<Set<string>>(new Set());
  const missingVoxelsRef = useRef<Set<string>>(new Set());
  const failedVoxelsRef = useRef<Map<string, number>>(new Map());
  const pendingVoxelFetchQueueRef = useRef<{ lod: number; regionX: number; regionY: number }[]>([]);
  const activeVoxelFetchCountRef = useRef(0);
  const pendingVoxelMeshQueueRef = useRef<PendingVoxelMeshItem[]>([]);
  const workerRef = useRef<Worker | null>(null);

  const surfaceIndexRef = useRef<SurfaceIndexEntry[]>([]);
  const chunkIndexRef = useRef(worldData.chunkIndex);

  const playersRef = useRef(players);
  playersRef.current = players;
  const worldDataRef = useRef(worldData);
  worldDataRef.current = worldData;

  const onCursorMoveRef = useRef(onCursorMove);
  onCursorMoveRef.current = onCursorMove;
  const onChunkStatsChangeRef = useRef(onChunkStatsChange);
  onChunkStatsChangeRef.current = onChunkStatsChange;
  const onShareStateChangeRef = useRef(onShareStateChange);
  onShareStateChangeRef.current = onShareStateChange;

  const showPlayersRef = useRef(showPlayers);
  showPlayersRef.current = showPlayers;
  const showSpawnRef = useRef(showSpawn);
  showSpawnRef.current = showSpawn;
  const showChunkBordersRef = useRef(showChunkBorders);
  showChunkBordersRef.current = showChunkBorders;
  const showTerrainRef = useRef(showTerrain);
  showTerrainRef.current = showTerrain;
  const showBiomeLabelsRef = useRef(showBiomeLabels);
  showBiomeLabelsRef.current = showBiomeLabels;
  const showVoxelHeightLabelsRef = useRef(showVoxelHeightLabels);
  showVoxelHeightLabelsRef.current = showVoxelHeightLabels;

  const keysHeldRef = useRef<Set<string>>(new Set());
  const terrainVisibilityDirtyRef = useRef(false);
  const debugLabelsDirtyRef = useRef(false);
  const biomeLabelsDirtyRef = useRef(false);
  const biomeRefreshTokenRef = useRef(0);
  const lastChunkStatsRef = useRef("");
  const activeFocusLodRef = useRef<number>(1);

  function terrainTileKey(lod: number, tileX: number, tileY: number): string {
    return `${lod}/${tileX}/${tileY}`;
  }

  function voxelTileKey(lod: number, regionX: number, regionY: number): string {
    return `${lod}/${regionX}/${regionY}`;
  }

  function terrainTileKeyAtWorld(lod: number, worldXPos: number, worldYPos: number): string {
    const size = 256 * lod;
    const tileX = Math.floor(worldXPos / size);
    const tileY = Math.floor(worldYPos / size);
    return terrainTileKey(lod, tileX, tileY);
  }

  function voxelTileKeyAtWorld(lod: number, worldXPos: number, worldYPos: number): string {
    const size = regionWorldSize(lod);
    const regionX = Math.floor(worldXPos / size) * size;
    const regionY = Math.floor(worldYPos / size) * size;
    return voxelTileKey(lod, regionX, regionY);
  }

  function hasLoadedTerrainTileAtWorld(lod: number, worldXPos: number, worldYPos: number): boolean {
    return loadedTerrainRef.current.has(terrainTileKeyAtWorld(lod, worldXPos, worldYPos));
  }

  function hasLoadedVoxelTileAtWorld(lod: number, worldXPos: number, worldYPos: number): boolean {
    return loadedVoxelsRef.current.has(voxelTileKeyAtWorld(lod, worldXPos, worldYPos));
  }

  function clearDebugLabels() {
    const group = debugLabelGroupRef.current;
    if (!group) return;
    for (const label of debugLabelMapRef.current.values()) {
      group.remove(label);
    }
    debugLabelMapRef.current.clear();
  }

  function clearBiomeLabels() {
    const group = biomeLabelGroupRef.current;
    if (!group) return;
    for (const label of biomeLabelMapRef.current.values()) {
      group.remove(label);
    }
    biomeLabelMapRef.current.clear();
  }

  function disposeTerrainTile(tile: LoadedTerrainTile) {
    terrainGroupRef.current?.remove(tile.mesh);
    tile.mesh.geometry.dispose();
    chunkBorderGroupRef.current?.remove(tile.borderLines);
    tile.borderLines.geometry.dispose();
    (tile.borderLines.material as THREE.Material).dispose();
    chunkBorderGroupRef.current?.remove(tile.borderLabel);
    disposeTextSprite(tile.borderLabel);
  }

  function clearTerrainTiles() {
    for (const tile of loadedTerrainRef.current.values()) {
      disposeTerrainTile(tile);
    }
    loadedTerrainRef.current.clear();
    loadingTerrainRef.current.clear();
  }

  function unloadVoxelTile(key: string) {
    const vt = loadedVoxelsRef.current.get(key);
    if (!vt) return;
    for (const sm of vt.subMeshes) {
      voxelGroupRef.current?.remove(sm.mesh);
      sm.mesh.geometry.dispose();
    }
    chunkBorderGroupRef.current?.remove(vt.borderLines);
    vt.borderLines.geometry.dispose();
    (vt.borderLines.material as THREE.Material).dispose();
    loadedVoxelsRef.current.delete(key);
    loadingVoxelsRef.current.delete(key);
  }

  function clearVoxelTiles() {
    for (const key of loadedVoxelsRef.current.keys()) {
      unloadVoxelTile(key);
    }
    loadedVoxelsRef.current.clear();
    loadingVoxelsRef.current.clear();
    missingVoxelsRef.current.clear();
    failedVoxelsRef.current.clear();
    pendingVoxelFetchQueueRef.current = [];
    pendingVoxelMeshQueueRef.current = [];
    activeVoxelFetchCountRef.current = 0;
  }

  async function fetchTerrain(lod: number, tileX: number, tileY: number): Promise<TerrainMeshData | null> {
    const url = `/api/terrain/${lod}/${tileX}/${tileY}`;
    try {
      return await queryClientRef.current.fetchQuery<TerrainMeshData | null>({
        queryKey: ["terrain", lod, tileX, tileY],
        queryFn: async () => {
          const res = await fetch(url);
          if (!res.ok) return null;
          return res.json() as Promise<TerrainMeshData>;
        },
        staleTime: Infinity,
        retry: false,
      });
    } catch (e) {
      console.error(`Failed to load terrain ${url}:`, e);
      return null;
    }
  }

  async function fetchBiomes(lod: number, tileX: number, tileY: number): Promise<BiomesResponse | null> {
    const url = `/api/biomes/${lod}/${tileX}/${tileY}`;
    try {
      return await queryClientRef.current.fetchQuery<BiomesResponse | null>({
        queryKey: ["biomes", lod, tileX, tileY],
        queryFn: async () => {
          const res = await fetch(url);
          if (!res.ok) return null;
          return res.json() as Promise<BiomesResponse>;
        },
        staleTime: 30_000,
        retry: false,
      });
    } catch {
      return null;
    }
  }

  async function loadTerrainTile(lod: number, tileX: number, tileY: number) {
    const key = terrainTileKey(lod, tileX, tileY);
    if (loadingTerrainRef.current.has(key) || loadedTerrainRef.current.has(key)) return;
    loadingTerrainRef.current.add(key);

    try {
      const data = await fetchTerrain(lod, tileX, tileY);
      if (!data || !terrainGroupRef.current) return;
      if (loadedTerrainRef.current.has(key)) return;

      const mesh = buildFullTileMesh(data);
      const border = buildSurfaceTileBorderLines(data.worldX, data.worldY, lod, mesh);

      terrainGroupRef.current.add(mesh);
      chunkBorderGroupRef.current?.add(border.lines);
      chunkBorderGroupRef.current?.add(border.label);

      loadedTerrainRef.current.set(key, {
        key,
        lod,
        tileX,
        tileY,
        worldX: data.worldX,
        worldY: data.worldY,
        mesh,
        borderLines: border.lines,
        borderLabel: border.label,
      });

      terrainVisibilityDirtyRef.current = true;
      debugLabelsDirtyRef.current = true;
      biomeLabelsDirtyRef.current = true;
    } catch (e) {
      console.error(`Failed to load terrain tile ${key}:`, e);
    } finally {
      loadingTerrainRef.current.delete(key);
    }
  }

  function updateTerrainVisibility(target: THREE.Vector3) {
    let changed = false;

    for (const tile of loadedTerrainRef.current.values()) {
      const tileWorldSize = 256 * tile.lod;
      const centerWorldX = tile.worldX + tileWorldSize / 2;
      const centerWorldY = tile.worldY + tileWorldSize / 2;
      const centerSceneY = -centerWorldY;
      const dx = centerWorldX - target.x;
      const dy = centerSceneY - target.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      const desiredLod = getTerrainLodForDistance(dist);
      const hasReplacement = hasLoadedTerrainTileAtWorld(desiredLod, centerWorldX, centerWorldY);
      const visible = tile.lod === desiredLod || !hasReplacement;

      if (tile.mesh.visible !== visible) {
        tile.mesh.visible = visible;
        changed = true;
      }
      tile.borderLines.visible = visible;
      tile.borderLabel.visible = visible;
    }

    if (changed) {
      debugLabelsDirtyRef.current = true;
      biomeLabelsDirtyRef.current = true;
    }
  }

  function requestVoxelRegion(lod: number, regionX: number, regionY: number) {
    const key = voxelTileKey(lod, regionX, regionY);
    if (loadingVoxelsRef.current.has(key) || loadedVoxelsRef.current.has(key)) return;
    if (missingVoxelsRef.current.has(key)) return;
    const retries = failedVoxelsRef.current.get(key);
    if (retries !== undefined && retries >= MAX_VOXEL_RETRIES) return;
    if (!workerRef.current) return;

    loadingVoxelsRef.current.add(key);

    if (activeVoxelFetchCountRef.current >= MAX_CONCURRENT_VOXEL_FETCHES) {
      pendingVoxelFetchQueueRef.current.push({ lod, regionX, regionY });
      return;
    }

    activeVoxelFetchCountRef.current++;
    void fetchVoxelRegion(lod, regionX, regionY);
  }

  function drainVoxelFetchQueue() {
    activeVoxelFetchCountRef.current = Math.max(0, activeVoxelFetchCountRef.current - 1);
    while (pendingVoxelFetchQueueRef.current.length > 0) {
      const next = pendingVoxelFetchQueueRef.current.shift()!;
      const key = voxelTileKey(next.lod, next.regionX, next.regionY);
      if (!loadingVoxelsRef.current.has(key)) continue;
      activeVoxelFetchCountRef.current++;
      void fetchVoxelRegion(next.lod, next.regionX, next.regionY);
      return;
    }
  }

  async function fetchVoxelRegion(lod: number, regionX: number, regionY: number) {
    const key = voxelTileKey(lod, regionX, regionY);
    try {
      const res = await fetch(`/api/voxels/${lod}/${regionX}/${regionY}`);
      if (res.status === 204) {
        missingVoxelsRef.current.add(key);
        loadingVoxelsRef.current.delete(key);
        drainVoxelFetchQueue();
        return;
      }
      if (!res.ok) {
        failedVoxelsRef.current.set(key, (failedVoxelsRef.current.get(key) ?? 0) + 1);
        loadingVoxelsRef.current.delete(key);
        drainVoxelFetchQueue();
        return;
      }

      const buffer = await res.arrayBuffer();
      if (!workerRef.current) {
        loadingVoxelsRef.current.delete(key);
        drainVoxelFetchQueue();
        return;
      }

      workerRef.current.postMessage({ buffer, lod, regionX, regionY }, [buffer]);
      drainVoxelFetchQueue();
    } catch (e) {
      console.error(`Failed to load voxel region ${key}:`, e);
      failedVoxelsRef.current.set(key, (failedVoxelsRef.current.get(key) ?? 0) + 1);
      loadingVoxelsRef.current.delete(key);
      drainVoxelFetchQueue();
    }
  }

  function updateVoxelLod(target: THREE.Vector3, camDist: number) {
    const index = chunkIndexRef.current;
    if (index.length === 0) return;

    const desiredLodByCell = new Set<string>();
    for (let lodIdx = LOD_LEVELS.length - 1; lodIdx >= 0; lodIdx--) {
      const lod = LOD_LEVELS[lodIdx];
      const cellSize = regionWorldSize(lod);
      const radiusBase = getUnloadDistForLod(lod);
      const radius = Number.isFinite(radiusBase)
        ? radiusBase
        : (LOD_DISTANCE_THRESHOLDS[LOD_DISTANCE_THRESHOLDS.length - 2]?.maxDist ?? 9600) * 2;
      const xMin = Math.floor((target.x - radius) / cellSize) * cellSize;
      const xMax = Math.floor((target.x + radius) / cellSize) * cellSize;
      const yWorldTarget = -target.y;
      const yMin = Math.floor((yWorldTarget - radius) / cellSize) * cellSize;
      const yMax = Math.floor((yWorldTarget + radius) / cellSize) * cellSize;

      for (let regionX = xMin; regionX <= xMax; regionX += cellSize) {
        for (let regionY = yMin; regionY <= yMax; regionY += cellSize) {
          const centerWorldX = regionX + cellSize / 2;
          const centerWorldY = regionY + cellSize / 2;
          const dx = centerWorldX - target.x;
          const dy = centerWorldY - yWorldTarget;
          const xyDist = Math.sqrt(dx * dx + dy * dy);
          const effectiveDist = Math.max(xyDist, camDist);
          const desiredLod = getLodForDistance(effectiveDist);
          if (desiredLod !== lod) continue;
          const key = `${lod}/${regionX}/${regionY}`;
          desiredLodByCell.add(key);
        }
      }
    }

    for (const entry of index) {
      const desiredKey = `${entry.lod}/${entry.regionX}/${entry.regionY}`;
      if (!desiredLodByCell.has(desiredKey)) continue;

      requestVoxelRegion(entry.lod, entry.regionX, entry.regionY);
    }

    const desiredKeyForPoint = (worldX: number, worldY: number): string => {
      const yWorldTarget = -target.y;
      const xyDist = Math.hypot(worldX - target.x, worldY - yWorldTarget);
      const effectiveDist = Math.max(xyDist, camDist);
      const desiredLod = getLodForDistance(effectiveDist);
      const desiredSize = regionWorldSize(desiredLod);
      const desiredRegionX = Math.floor(worldX / desiredSize) * desiredSize;
      const desiredRegionY = Math.floor(worldY / desiredSize) * desiredSize;
      return voxelTileKey(desiredLod, desiredRegionX, desiredRegionY);
    };

    const hasAllImmediateFinerChildrenLoaded = (tile: LoadedVoxelTile): boolean => {
      if (tile.lod <= 1) return false;
      const finerLod = tile.lod / 2;
      const childSize = regionWorldSize(finerLod);
      for (let ox = 0; ox <= childSize; ox += childSize) {
        for (let oy = 0; oy <= childSize; oy += childSize) {
          const childKey = voxelTileKey(finerLod, tile.regionX + ox, tile.regionY + oy);
          if (!loadedVoxelsRef.current.has(childKey)) return false;
        }
      }
      return true;
    };

    const hasAnyImmediateFinerChildLoaded = (tile: LoadedVoxelTile): boolean => {
      if (tile.lod <= 1) return false;
      const finerLod = tile.lod / 2;
      const childSize = regionWorldSize(finerLod);
      for (let ox = 0; ox <= childSize; ox += childSize) {
        for (let oy = 0; oy <= childSize; oy += childSize) {
          const childKey = voxelTileKey(finerLod, tile.regionX + ox, tile.regionY + oy);
          if (loadedVoxelsRef.current.has(childKey)) return true;
        }
      }
      return false;
    };

    const hasChildAt = (finerLod: number, worldX: number, worldY: number): boolean => {
      return loadedVoxelsRef.current.has(voxelTileKeyAtWorld(finerLod, worldX, worldY));
    };

    let changed = false;
    for (const [key, tile] of loadedVoxelsRef.current) {
      const regSize = regionWorldSize(tile.lod);
      const centerWorldX = tile.regionX + regSize / 2;
      const centerWorldY = tile.regionY + regSize / 2;
      const centerSceneY = -centerWorldY;

      const dx = centerWorldX - target.x;
      const dy = centerSceneY - target.y;
      const xyDist = Math.sqrt(dx * dx + dy * dy);
      const dist = Math.max(xyDist, camDist);
      const unloadDist = getUnloadDistForLod(tile.lod) * 1.1;

      const isDesiredNow = desiredLodByCell.has(key);
      const desiredCenterKey = desiredKeyForPoint(centerWorldX, centerWorldY);
      const desiredCenter = parseVoxelKey(desiredCenterKey);
      const desiredCenterLoaded = loadedVoxelsRef.current.has(desiredCenterKey);

      let replacedByPriority = false;
      let visible = true;

      // Partial occlusion: hide only 32x32 sub-cells of this tile that are
      // already covered by finer loaded tiles.
      const chunkSizeWorld = chunkWorldSize(tile.lod);
      let anyVisibleSubMesh = false;
      for (const sm of tile.subMeshes) {
        let smVisible = true;
        for (const finerLod of LOD_LEVELS) {
          if (finerLod >= tile.lod) continue;
          if (hasChildAt(finerLod, sm.worldX + chunkSizeWorld / 2, sm.worldY + chunkSizeWorld / 2)) {
            smVisible = false;
            break;
          }
        }
        if (sm.mesh.visible !== smVisible) {
          sm.mesh.visible = smVisible;
          changed = true;
        }
        if (smVisible) anyVisibleSubMesh = true;
      }

      visible = anyVisibleSubMesh;

      if (!isDesiredNow && desiredCenter) {
        if (desiredCenter.lod > tile.lod) {
          // Zoomed out: a coarser region is preferred for this area.
          replacedByPriority = desiredCenterLoaded;
          visible = !replacedByPriority && anyVisibleSubMesh;
        } else if (desiredCenter.lod < tile.lod) {
          // Zoomed in: as soon as any immediate finer child is loaded, hide the
          // coarse tile to avoid visible overlap. Keep it in memory until all
          // immediate finer children are ready, then unload.
          const anyFinerLoaded = hasAnyImmediateFinerChildLoaded(tile);
          if (anyFinerLoaded) {
            visible = false && anyVisibleSubMesh;
          }
          replacedByPriority = hasAllImmediateFinerChildrenLoaded(tile);
          if (replacedByPriority) {
            visible = false && anyVisibleSubMesh;
          }
        }
      }

      tile.borderLines.visible = visible;
      if (!visible) {
        for (const sm of tile.subMeshes) {
          if (sm.mesh.visible) {
            sm.mesh.visible = false;
            changed = true;
          }
        }
      }

      if (tile.borderLines.visible !== visible) {
        changed = true;
      }

      if (replacedByPriority && !isDesiredNow) {
        unloadVoxelTile(key);
        changed = true;
        continue;
      }

      if (dist > unloadDist) {
        // Hard cutoff to guarantee old chunks eventually unload even if no
        // replacement exists for sparse/missing data at this location.
        if (dist > unloadDist * 1.35) {
          unloadVoxelTile(key);
          changed = true;
          continue;
        }

        const replacementLod = getLodForDistance(dist);
        if (
          replacementLod !== tile.lod
          && !hasLoadedVoxelTileAtWorld(replacementLod, centerWorldX, centerWorldY)
        ) {
          continue;
        }
        unloadVoxelTile(key);
        changed = true;
      }
    }

    for (const key of [...loadingVoxelsRef.current]) {
      const parsed = parseVoxelKey(key);
      if (!parsed) continue;
      const regSize = regionWorldSize(parsed.lod);
      const centerWorldX = parsed.regionX + regSize / 2;
      const centerWorldY = parsed.regionY + regSize / 2;
      const centerSceneY = -centerWorldY;
      const dx = centerWorldX - target.x;
      const dy = centerSceneY - target.y;
      const xyDist = Math.sqrt(dx * dx + dy * dy);
      const dist = Math.max(xyDist, camDist);
        if (dist > getUnloadDistForLod(parsed.lod) * 1.1) {
          loadingVoxelsRef.current.delete(key);
          pendingVoxelMeshQueueRef.current = pendingVoxelMeshQueueRef.current.filter((q) => q.key !== key);
        }
      }

    if (changed) {
      debugLabelsDirtyRef.current = true;
    }
  }

  async function refreshBiomeLabels(target: THREE.Vector3) {
    if (!showBiomeLabelsRef.current) {
      clearBiomeLabels();
      return;
    }

    const group = biomeLabelGroupRef.current;
    if (!group) return;

    const token = ++biomeRefreshTokenRef.current;

    const visibleTiles: {
      key: string;
      lod: number;
      tileX: number;
      tileY: number;
      z: number;
    }[] = [];

    if (modeRef.current === "terrain") {
      for (const tile of loadedTerrainRef.current.values()) {
        if (!tile.mesh.visible) continue;
        visibleTiles.push({
          key: tile.key,
          lod: tile.lod,
          tileX: tile.tileX,
          tileY: tile.tileY,
          z: (tile.mesh.geometry.boundingBox?.max.z ?? 0) + 10,
        });
      }
      visibleTiles.sort((a, b) => {
        const aWorldX = a.tileX * 256 * a.lod + (256 * a.lod) / 2;
        const aWorldY = a.tileY * 256 * a.lod + (256 * a.lod) / 2;
        const bWorldX = b.tileX * 256 * b.lod + (256 * b.lod) / 2;
        const bWorldY = b.tileY * 256 * b.lod + (256 * b.lod) / 2;
        const ad = Math.hypot(aWorldX - target.x, -aWorldY - target.y);
        const bd = Math.hypot(bWorldX - target.x, -bWorldY - target.y);
        return ad - bd;
      });
    } else {
      const indexedTiles = surfaceIndexRef.current
        .map((entry) => {
          const tileWorldSize = 256 * entry.lod;
          const centerX = entry.worldX + tileWorldSize / 2;
          const centerY = entry.worldY + tileWorldSize / 2;
          const dist = Math.hypot(centerX - target.x, -centerY - target.y);
          return {
            entry,
            dist,
            desiredLod: getTerrainLodForDistance(dist),
          };
        })
        .filter((item) => item.entry.lod === item.desiredLod)
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 14);

      for (const item of indexedTiles) {
        const tileSize = 256 * item.entry.lod;
        const tileCenterX = item.entry.worldX + tileSize / 2;
        const tileCenterY = item.entry.worldY + tileSize / 2;
        let labelZ = target.z + 12;
        for (const voxelTile of loadedVoxelsRef.current.values()) {
          const regionSize = regionWorldSize(voxelTile.lod);
          if (
            tileCenterX >= voxelTile.regionX
            && tileCenterX < voxelTile.regionX + regionSize
            && tileCenterY >= voxelTile.regionY
            && tileCenterY < voxelTile.regionY + regionSize
          ) {
            labelZ = Math.max(labelZ, voxelTile.maxZ + 10);
          }
        }
        visibleTiles.push({
          key: terrainTileKey(item.entry.lod, item.entry.tileX, item.entry.tileY),
          lod: item.entry.lod,
          tileX: item.entry.tileX,
          tileY: item.entry.tileY,
          z: labelZ,
        });
      }
    }

    if (visibleTiles.length > 14) {
      visibleTiles.length = 14;
    }

    if (visibleTiles.length === 0) {
      clearBiomeLabels();
      return;
    }

    const fetched = await Promise.all(
      visibleTiles.map(async (tile) => ({
        tile,
        data: await fetchBiomes(tile.lod, tile.tileX, tile.tileY),
      })),
    );

    if (token !== biomeRefreshTokenRef.current) return;

    const candidates: {
      key: string;
      text: string;
      x: number;
      y: number;
      z: number;
      score: number;
    }[] = [];

    for (const item of fetched) {
      if (!item.data) continue;
      let perTile = 0;
      for (const region of item.data.regions) {
        if (region.count < 256) continue;
        candidates.push({
          key: `${item.tile.key}#${region.centerX.toFixed(1)}#${region.centerY.toFixed(1)}`,
          text: formatBiomeName(region.biomeName),
          x: region.centerX,
          y: region.centerY,
          z: item.tile.z,
          score: region.count,
        });
        perTile++;
        if (perTile >= 4) break;
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    const picked = candidates.slice(0, MAX_BIOME_LABELS);

    const active = new Set<string>();

    for (const labelData of picked) {
      active.add(labelData.key);

      let label = biomeLabelMapRef.current.get(labelData.key);
      if (!label) {
        const div = document.createElement("div");
        div.style.cssText = "color: rgba(255,255,255,0.78); font-size: 11px; font-weight: 600; text-shadow: 0 0 4px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.5); pointer-events: none; white-space: nowrap;";
        label = new CSS2DObject(div);
        group.add(label);
        biomeLabelMapRef.current.set(labelData.key, label);
      }

      const el = label.element as HTMLDivElement;
      el.textContent = labelData.text;
      label.position.set(labelData.x, -labelData.y, labelData.z);
    }

    for (const [key, label] of biomeLabelMapRef.current) {
      if (!active.has(key)) {
        group.remove(label);
        biomeLabelMapRef.current.delete(key);
      }
    }
  }

  function refreshDebugLabels() {
    const group = debugLabelGroupRef.current;
    if (!group) return;

    const showTiles = showChunkBordersRef.current;
    const showHeights = showVoxelHeightLabelsRef.current && modeRef.current === "voxel";
    if (!showTiles && !showHeights) {
      clearDebugLabels();
      return;
    }

    const active = new Set<string>();

    if (modeRef.current === "terrain") {
      for (const tile of loadedTerrainRef.current.values()) {
        if (!showTiles) continue;
        if (!tile.mesh.visible) continue;
        const key = tile.key;
        active.add(key);
        const text = `T L${tile.lod} ${tile.worldX}/${tile.worldY}`;
        const x = tile.worldX + (256 * tile.lod) / 2;
        const y = -(tile.worldY + (256 * tile.lod) / 2);
        const z = (tile.mesh.geometry.boundingBox?.max.z ?? 0) + 6;

        const lodColor = getLodBorderColor(tile.lod).label;
        let label = debugLabelMapRef.current.get(key);
        if (label) {
          const el = label.element as HTMLDivElement;
          el.textContent = text;
          el.style.color = lodColor;
          el.style.borderColor = lodColor;
          label.position.set(x, y, z);
        } else {
          const div = document.createElement("div");
          div.textContent = text;
          div.style.cssText = `color: ${lodColor}; font-size: 11px; font-family: monospace; font-weight: bold; background: rgba(0, 0, 0, 0.7); padding: 2px 4px; border: 1px solid ${lodColor}; border-radius: 3px; white-space: nowrap; pointer-events: none;`;
          label = new CSS2DObject(div);
          label.position.set(x, y, z);
          group.add(label);
          debugLabelMapRef.current.set(key, label);
        }
      }
    } else {
      for (const tile of loadedVoxelsRef.current.values()) {
        if (!tile.borderLines.visible && !showHeights) continue;
        const key = tile.key;
        active.add(key);

        const parts: string[] = [];
        if (showTiles) {
          parts.push(`V L${tile.lod} ${tile.regionX}/${tile.regionY}`);
        }
        if (showHeights) {
          const tops = [...tile.chunkTopHeights].filter((v) => Number.isFinite(v));
          const topMin = tops.length > 0 ? Math.min(...tops) : Number.NaN;
          const topMax = tops.length > 0 ? Math.max(...tops) : Number.NaN;
          const covered = countBits16(tile.chunkCoverage);
          parts.push(`topMin:${formatHeight(topMin)} topMax:${formatHeight(topMax)} cov:${covered}/16`);
        }
        if (parts.length === 0) continue;

        const text = parts.join("  ");
        const regSize = regionWorldSize(tile.lod);
        const x = tile.regionX + regSize / 2;
        const y = -(tile.regionY + regSize / 2);
        const z = tile.maxZ + 6;

        const lodColor = getLodBorderColor(tile.lod).label;
        let label = debugLabelMapRef.current.get(key);
        if (label) {
          const el = label.element as HTMLDivElement;
          el.textContent = text;
          if (showTiles) {
            el.style.color = lodColor;
            el.style.borderColor = lodColor;
          }
          label.position.set(x, y, z);
        } else {
          const div = document.createElement("div");
          div.textContent = text;
          div.style.cssText = `color: ${showTiles ? lodColor : "#00ff88"}; font-size: 11px; font-family: monospace; font-weight: bold; background: rgba(0, 0, 0, 0.7); padding: 2px 4px; border: 1px solid ${showTiles ? lodColor : "#00ff88"}; border-radius: 3px; white-space: nowrap; pointer-events: none;`;
          label = new CSS2DObject(div);
          label.position.set(x, y, z);
          group.add(label);
          debugLabelMapRef.current.set(key, label);
        }
      }
    }

    for (const [key, label] of debugLabelMapRef.current) {
      if (!active.has(key)) {
        group.remove(label);
        debugLabelMapRef.current.delete(key);
      }
    }
  }

  function addSpawnMarker() {
    const spawn = worldDataRef.current.worldData?.spawn;
    if (!spawn || !spawnGroupRef.current) return;

    while (spawnGroupRef.current.children.length > 0) {
      const child = spawnGroupRef.current.children[0];
      spawnGroupRef.current.remove(child);
      if (child instanceof THREE.Sprite) {
        disposeTextSprite(child);
      }
    }

    const [sx, sy, sz] = worldToScene(spawn[0], spawn[1], spawn[2]);
    const dot = createMarkerDot("#ff4444", 17);
    dot.position.set(sx, sy, sz + 8);
    spawnGroupRef.current.add(dot);

    const label = createMarkerLabel("Spawn", "#ff6b6b");
    label.position.set(sx, sy, sz + 24);
    spawnGroupRef.current.add(label);
  }

  function updatePlayerMarkers() {
    const group = markerGroupRef.current;
    if (!group) return;

    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      if (child instanceof THREE.Sprite) {
        disposeTextSprite(child);
      }
    }

    for (const player of playersRef.current) {
      const [px, py, pz] = worldToScene(player.position[0], player.position[1], player.position[2]);

      const dot = createMarkerDot("#44aaff", 15);
      dot.position.set(px, py, pz + 6);
      group.add(dot);

      const label = createMarkerLabel(cleanPlayerName(player.name), "#6ec1ff");
      label.position.set(px, py, pz + 22);
      group.add(label);
    }
  }

  function updateMarkerScales(_: THREE.PerspectiveCamera, __: OrbitControls) {
    // Marker labels are CSS2D-based and intentionally keep constant screen size,
    // matching biome labels readability across zoom levels.
  }

  function handleTileUpdate(lod: number, tileX: number, tileY: number) {
    queryClientRef.current.invalidateQueries({ queryKey: ["terrain", lod, tileX, tileY] });
    queryClientRef.current.invalidateQueries({ queryKey: ["biomes", lod, tileX, tileY] });

    const key = terrainTileKey(lod, tileX, tileY);
    const existing = loadedTerrainRef.current.get(key);
    if (existing) {
      disposeTerrainTile(existing);
      loadedTerrainRef.current.delete(key);
      if (modeRef.current === "terrain") {
        void loadTerrainTile(lod, tileX, tileY);
      }
      debugLabelsDirtyRef.current = true;
      biomeLabelsDirtyRef.current = true;
    }
  }

  function handleRegionUpdate(lod: number, regionX: number, regionY: number) {
    const key = voxelTileKey(lod, regionX, regionY);
    missingVoxelsRef.current.delete(key);
    failedVoxelsRef.current.delete(key);
    if (loadedVoxelsRef.current.has(key)) {
      unloadVoxelTile(key);
      if (modeRef.current === "voxel") {
        requestVoxelRegion(lod, regionX, regionY);
      }
      debugLabelsDirtyRef.current = true;
    }
  }

  function resolveVoxelLodFocus(camera: THREE.PerspectiveCamera, controls: OrbitControls): {
    point: THREE.Vector3;
    zoomDist: number;
  } {
    const fallbackPoint = controls.target.clone();
    const fallbackZoomDist = camera.position.distanceTo(controls.target);

    const voxelGroup = voxelGroupRef.current;
    if (!voxelGroup || voxelGroup.children.length === 0) {
      return { point: fallbackPoint, zoomDist: fallbackZoomDist };
    }

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const intersections = raycaster.intersectObjects(voxelGroup.children, false);
    if (intersections.length === 0) {
      return { point: fallbackPoint, zoomDist: fallbackZoomDist };
    }

    const hitPoint = intersections[0].point.clone();
    const hitZoomDist = camera.position.distanceTo(intersections[0].point);
    return {
      point: hitPoint,
      zoomDist: Math.min(fallbackZoomDist, hitZoomDist),
    };
  }

  function checkAndUpdateLOD(camera: THREE.PerspectiveCamera, controls: OrbitControls) {
    const target = controls.target;

    if (modeRef.current === "terrain") {
      activeFocusLodRef.current = getTerrainLodForDistance(camera.position.distanceTo(target));
      const index = surfaceIndexRef.current;
      if (index.length > 0) {
        for (const entry of index) {
          const tileWorldSize = 256 * entry.lod;
          const centerX = entry.worldX + tileWorldSize / 2;
          const centerY = -(entry.worldY + tileWorldSize / 2);
          const dist = Math.hypot(centerX - target.x, centerY - target.y);
          const desiredLod = getTerrainLodForDistance(dist);
          if (entry.lod !== desiredLod) continue;
          const key = terrainTileKey(entry.lod, entry.tileX, entry.tileY);
          if (loadedTerrainRef.current.has(key) || loadingTerrainRef.current.has(key)) continue;
          void loadTerrainTile(entry.lod, entry.tileX, entry.tileY);
        }
      }

      for (const [key, tile] of loadedTerrainRef.current) {
        const tileWorldSize = 256 * tile.lod;
        const centerWorldX = tile.worldX + tileWorldSize / 2;
        const centerWorldY = tile.worldY + tileWorldSize / 2;
        const centerSceneY = -centerWorldY;
        const dist = Math.hypot(centerWorldX - target.x, centerSceneY - target.y);
        const unloadDist = getTerrainUnloadDistForLod(tile.lod);
        if (dist > unloadDist) {
          // Guarantee eventual eviction for far-away terrain even when no
          // replacement LOD tile exists at this location.
          if (dist > unloadDist * 1.35) {
            disposeTerrainTile(tile);
            loadedTerrainRef.current.delete(key);
            debugLabelsDirtyRef.current = true;
            biomeLabelsDirtyRef.current = true;
            continue;
          }

          const replacementLod = getTerrainLodForDistance(dist);
          if (
            replacementLod !== tile.lod
            && !hasLoadedTerrainTileAtWorld(replacementLod, centerWorldX, centerWorldY)
          ) {
            continue;
          }
          disposeTerrainTile(tile);
          loadedTerrainRef.current.delete(key);
          debugLabelsDirtyRef.current = true;
          biomeLabelsDirtyRef.current = true;
        }
      }

      updateTerrainVisibility(target);
      terrainVisibilityDirtyRef.current = false;
    } else {
      const focus = resolveVoxelLodFocus(camera, controls);
      activeFocusLodRef.current = getLodForDistance(focus.zoomDist);
      updateVoxelLod(focus.point, focus.zoomDist);
    }

    if (debugLabelsDirtyRef.current) {
      debugLabelsDirtyRef.current = false;
      refreshDebugLabels();
    }
    if (biomeLabelsDirtyRef.current) {
      biomeLabelsDirtyRef.current = false;
      void refreshBiomeLabels(target);
    }

    const offset = camera.position.clone().sub(target);
    const r = offset.length();
    if (r >= 0.001) {
      onShareStateChangeRef.current({
        mode: modeRef.current,
        pos: [Math.round(target.x), Math.round(-target.y), Math.round(target.z)],
        zoom: Math.round(r),
        theta: Math.round(THREE.MathUtils.radToDeg(Math.atan2(offset.y, offset.x))),
        phi: Math.round(THREE.MathUtils.radToDeg(Math.acos(Math.max(-1, Math.min(1, offset.z / r))))),
      });
    }
  }

  useEffect(() => {
    if (!containerRef.current || sceneRef.current) return;
    const container = containerRef.current;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);

    const camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 1, 50000);
    camera.up.set(0, 0, 1);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.maxDistance = 10000;
    controls.screenSpacePanning = false;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    controls.touches = {
      ONE: THREE.TOUCH.PAN,
      TWO: THREE.TOUCH.DOLLY_ROTATE,
    };

    scene.add(new THREE.AmbientLight(0x404060, 1.5));
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
    directionalLight.position.set(100, -100, 200);
    scene.add(directionalLight);
    const fillLight = new THREE.DirectionalLight(0x8888aa, 0.4);
    fillLight.position.set(-50, 50, 100);
    scene.add(fillLight);

    const terrainGroup = new THREE.Group();
    const voxelGroup = new THREE.Group();
    const markerGroup = new THREE.Group();
    const spawnGroup = new THREE.Group();
    const chunkBorderGroup = new THREE.Group();
    scene.add(terrainGroup, voxelGroup, markerGroup, spawnGroup, chunkBorderGroup);
    terrainGroupRef.current = terrainGroup;
    voxelGroupRef.current = voxelGroup;
    markerGroupRef.current = markerGroup;
    spawnGroupRef.current = spawnGroup;
    chunkBorderGroupRef.current = chunkBorderGroup;

    const labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(container.clientWidth, container.clientHeight);
    labelRenderer.domElement.style.position = "absolute";
    labelRenderer.domElement.style.top = "0";
    labelRenderer.domElement.style.left = "0";
    labelRenderer.domElement.style.pointerEvents = "none";
    container.appendChild(labelRenderer.domElement);
    labelRendererRef.current = labelRenderer;

    const debugLabelGroup = new THREE.Group();
    const biomeLabelGroup = new THREE.Group();
    scene.add(debugLabelGroup);
    scene.add(biomeLabelGroup);
    debugLabelGroupRef.current = debugLabelGroup;
    biomeLabelGroupRef.current = biomeLabelGroup;

    const preUploadTarget = new THREE.WebGLRenderTarget(1, 1);
    const preUploadScene = new THREE.Scene();
    const preUploadCamera = new THREE.PerspectiveCamera();

    const worker = new Worker(new URL("../workers/voxel-mesh.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    worker.onmessage = (e: MessageEvent) => {
      const {
        lod,
        regionX,
        regionY,
        positions,
        normals,
        colors,
        indices,
        chunkCoverage,
        chunkTopHeights,
        voxelSize,
        error,
      } = e.data as WorkerOut;

      const resolvedLod = lod ?? 1;
      const key = voxelTileKey(resolvedLod, regionX, regionY);
      if (error || !positions || !normals || !colors || !indices) {
        loadingVoxelsRef.current.delete(key);
        failedVoxelsRef.current.set(key, (failedVoxelsRef.current.get(key) ?? 0) + 1);
        return;
      }

      const topHeights = chunkTopHeights && chunkTopHeights.length === 16
        ? chunkTopHeights
        : new Float32Array(16).fill(Number.NEGATIVE_INFINITY);

      pendingVoxelMeshQueueRef.current.push({
        key,
        lod: resolvedLod,
        regionX,
        regionY,
        positions,
        normals,
        colors,
        indices,
        chunkCoverage: chunkCoverage ?? 0,
        chunkTopHeights: topHeights,
        voxelSize: voxelSize ?? resolvedLod,
      });
    };

    worker.onerror = (e) => {
      console.error("voxel-mesh worker error:", e.message);
    };

    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();
    const hoverState = { active: false, clientX: 0, clientY: 0 };
    let isPointerInteracting = false;
    let cursorRefreshTimer: number | null = null;

    function clearCursorRefreshTimer() {
      if (cursorRefreshTimer === null) return;
      window.clearTimeout(cursorRefreshTimer);
      cursorRefreshTimer = null;
    }

    function scheduleCursorTooltipRefresh() {
      if (!hoverState.active || isPointerInteracting || keysHeldRef.current.size > 0) return;
      clearCursorRefreshTimer();
      cursorRefreshTimer = window.setTimeout(() => {
        cursorRefreshTimer = null;
        if (!hoverState.active || isPointerInteracting || keysHeldRef.current.size > 0) return;
        updateCursorTooltip();
      }, 50);
    }

    function updateCursorTooltip() {
      if (!hoverState.active) return;
      if (isPointerInteracting || keysHeldRef.current.size > 0) return;

      const targets: THREE.Object3D[] = [];
      if (modeRef.current === "terrain" && showTerrainRef.current && terrainGroupRef.current) {
        targets.push(terrainGroupRef.current);
      }
      if (modeRef.current === "voxel" && voxelGroupRef.current) {
        targets.push(voxelGroupRef.current);
      }
      if (targets.length === 0) {
        onCursorMoveRef.current(null);
        return;
      }

      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        onCursorMoveRef.current(null);
        return;
      }

      pointerNdc.x = ((hoverState.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((hoverState.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointerNdc, camera);

      const intersections = raycaster.intersectObjects(targets, true);
      if (intersections.length === 0) {
        onCursorMoveRef.current(null);
        return;
      }

      const point = intersections[0].point;
      onCursorMoveRef.current([Math.round(point.x), Math.round(-point.y), Math.round(point.z)]);
    }

    function onPointerMove(e: PointerEvent) {
      hoverState.active = true;
      hoverState.clientX = e.clientX;
      hoverState.clientY = e.clientY;
      if (isPointerInteracting || keysHeldRef.current.size > 0) return;
      updateCursorTooltip();
    }

    function onPointerDown() {
      isPointerInteracting = true;
      clearCursorRefreshTimer();
      onCursorMoveRef.current(null);
    }

    function onPointerUp() {
      isPointerInteracting = false;
      scheduleCursorTooltipRefresh();
    }

    function onPointerCancel() {
      isPointerInteracting = false;
      clearCursorRefreshTimer();
      onCursorMoveRef.current(null);
    }

    function onPointerLeave() {
      hoverState.active = false;
      isPointerInteracting = false;
      clearCursorRefreshTimer();
      onCursorMoveRef.current(null);
    }

    function focusCameraOnSpawn() {
      const spawn = worldDataRef.current.worldData?.spawn;
      if (!spawn) return;
      const [sx, sy, sz] = worldToScene(spawn[0], spawn[1], spawn[2]);
      const offset = camera.position.clone().sub(controls.target);
      controls.target.set(sx, sy, sz);
      camera.position.copy(controls.target).add(offset);
      controls.update();
      terrainVisibilityDirtyRef.current = true;
      debugLabelsDirtyRef.current = true;
      biomeLabelsDirtyRef.current = true;
    }

    let animFrameId = 0;
    let lodCheckCounter = 0;
    let biomeRefreshCounter = 0;
    let fpsFrameCounter = 0;
    let fpsLastTs = performance.now();
    let fpsValue = 0;
    const LOD_CHECK_INTERVAL = 60;

    function animate() {
      animFrameId = requestAnimationFrame(animate);

      const keys = keysHeldRef.current;
      if (keys.size > 0) {
        const dist = camera.position.distanceTo(controls.target);
        const speed = Math.max(1, dist * 0.015);

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

          if (keys.has("KeyW") || keys.has("ArrowUp")) { moveX += fx; moveY += fy; }
          if (keys.has("KeyS") || keys.has("ArrowDown")) { moveX -= fx; moveY -= fy; }
          if (keys.has("KeyA") || keys.has("ArrowLeft")) { moveX -= rx; moveY -= ry; }
          if (keys.has("KeyD") || keys.has("ArrowRight")) { moveX += rx; moveY += ry; }
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
          offset.applyAxisAngle(new THREE.Vector3(0, 0, 1), rotateDir * 0.025);
          camera.position.copy(controls.target).add(offset);
        }
      }

      controls.update();
      updateMarkerScales(camera, controls);

      if (pendingVoxelMeshQueueRef.current.length > 0) {
        const item = pendingVoxelMeshQueueRef.current.shift()!;
        loadingVoxelsRef.current.delete(item.key);
        if (!loadedVoxelsRef.current.has(item.key) && voxelGroupRef.current && modeRef.current === "voxel") {
          const built = buildVoxelColumnSubMeshes(item);
          if (built.subMeshes.length > 0) {
            for (const sm of built.subMeshes) {
              preUploadScene.add(sm.mesh);
            }
            renderer.setRenderTarget(preUploadTarget);
            renderer.render(preUploadScene, preUploadCamera);
            renderer.setRenderTarget(null);
            for (const sm of built.subMeshes) {
              preUploadScene.remove(sm.mesh);
            }

            const borderLines = buildVoxelBorderLines(item.regionX, item.regionY, item.lod, built.minZ, built.maxZ);

            for (const sm of built.subMeshes) {
              voxelGroupRef.current.add(sm.mesh);
            }
            chunkBorderGroupRef.current?.add(borderLines);
            loadedVoxelsRef.current.set(item.key, {
              key: item.key,
              lod: item.lod,
              regionX: item.regionX,
              regionY: item.regionY,
              voxelSize: item.voxelSize,
              subMeshes: built.subMeshes,
              minZ: built.minZ,
              maxZ: built.maxZ,
              chunkCoverage: item.chunkCoverage,
              chunkTopHeights: item.chunkTopHeights,
              borderLines,
            });
            failedVoxelsRef.current.delete(item.key);
            debugLabelsDirtyRef.current = true;
          }
        }
      }

      if (terrainVisibilityDirtyRef.current && modeRef.current === "terrain") {
        updateTerrainVisibility(controls.target);
        terrainVisibilityDirtyRef.current = false;
      }

      if (debugLabelsDirtyRef.current) {
        debugLabelsDirtyRef.current = false;
        refreshDebugLabels();
      }

      if (showBiomeLabelsRef.current && biomeLabelsDirtyRef.current) {
        biomeRefreshCounter++;
        if (biomeRefreshCounter % 20 === 0) {
          biomeLabelsDirtyRef.current = false;
          void refreshBiomeLabels(controls.target);
        }
      }

      renderer.render(scene, camera);
      labelRenderer.render(scene, camera);

      fpsFrameCounter++;
      const fpsNow = performance.now();
      if (fpsNow - fpsLastTs >= 500) {
        fpsValue = Math.round((fpsFrameCounter * 1000) / (fpsNow - fpsLastTs));
        fpsFrameCounter = 0;
        fpsLastTs = fpsNow;
      }

      const loadingTerrainCount = loadingTerrainRef.current.size;
      const loadingVoxelCount = loadingVoxelsRef.current.size;
      const fetchQueueCount = pendingVoxelFetchQueueRef.current.length;
      const meshQueueCount = pendingVoxelMeshQueueRef.current.length;
      const loadingCount = loadingTerrainCount + loadingVoxelCount + fetchQueueCount + meshQueueCount;
      const loadedCount = modeRef.current === "terrain"
        ? loadedTerrainRef.current.size
        : loadedVoxelsRef.current.size;
      const loadedByLod: Partial<Record<1 | 2 | 4 | 8 | 16 | 32, number>> = {};
      if (modeRef.current === "terrain") {
        for (const tile of loadedTerrainRef.current.values()) {
          const lod = tile.lod as 1 | 2 | 4 | 8 | 16 | 32;
          loadedByLod[lod] = (loadedByLod[lod] ?? 0) + 1;
        }
      } else {
        for (const tile of loadedVoxelsRef.current.values()) {
          const lod = tile.lod as 1 | 2 | 4 | 8 | 16 | 32;
          loadedByLod[lod] = (loadedByLod[lod] ?? 0) + 1;
        }
      }

      const statsPayload = {
        loading: loadingCount,
        loaded: loadedCount,
        fps: fpsValue,
        focusLod: activeFocusLodRef.current,
        mode: modeRef.current,
        loadingBreakdown: {
          terrain: loadingTerrainCount,
          voxels: loadingVoxelCount,
          fetchQueue: fetchQueueCount,
          meshQueue: meshQueueCount,
        },
        voxelHealth: {
          missing: missingVoxelsRef.current.size,
          failed: failedVoxelsRef.current.size,
        },
        loadedByLod,
      };
      const statsKey = JSON.stringify(statsPayload);
      if (lastChunkStatsRef.current !== statsKey) {
        lastChunkStatsRef.current = statsKey;
        onChunkStatsChangeRef.current(statsPayload);
      }

      lodCheckCounter++;
      if (lodCheckCounter >= LOD_CHECK_INTERVAL) {
        lodCheckCounter = 0;
        checkAndUpdateLOD(camera, controls);
      }
    }

    animate();

    function onResize() {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      labelRenderer.setSize(w, h);
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === "Space") {
        e.preventDefault();
        focusCameraOnSpawn();
        return;
      }
      const hadKeys = keysHeldRef.current.size > 0;
      keysHeldRef.current.add(e.code);
      if (!hadKeys) {
        clearCursorRefreshTimer();
        onCursorMoveRef.current(null);
      }
    }

    function onKeyUp(e: KeyboardEvent) {
      keysHeldRef.current.delete(e.code);
      if (keysHeldRef.current.size === 0) {
        scheduleCursorTooltipRefresh();
      }
    }

    function onControlsChange() {
      if (isPointerInteracting || keysHeldRef.current.size > 0) return;
      scheduleCursorTooltipRefresh();
    }

    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    controls.addEventListener("change", onControlsChange);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerCancel);
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);

    sceneRef.current = { renderer, scene, camera, controls, animFrameId };

    return () => {
      cancelAnimationFrame(animFrameId);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      controls.removeEventListener("change", onControlsChange);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerCancel);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      clearCursorRefreshTimer();

      clearTerrainTiles();
      clearVoxelTiles();
      clearDebugLabels();
      clearBiomeLabels();

      controls.dispose();
      preUploadTarget.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
      if (labelRendererRef.current) {
        container.removeChild(labelRendererRef.current.domElement);
        labelRendererRef.current = null;
      }

      worker.terminate();
      workerRef.current = null;
      terrainMaterial.dispose();
      voxelMaterial.dispose();

      sceneRef.current = null;
      terrainGroupRef.current = null;
      voxelGroupRef.current = null;
      markerGroupRef.current = null;
      spawnGroupRef.current = null;
      chunkBorderGroupRef.current = null;
      debugLabelGroupRef.current = null;
      biomeLabelGroupRef.current = null;
      initializedRef.current = false;
      keysHeldRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (initializedRef.current) return;
    if (!sceneRef.current) return;
    if (worldData.loading) return;

    initializedRef.current = true;
    surfaceIndexRef.current = worldData.surfaceIndex;
    chunkIndexRef.current = worldData.chunkIndex;

    const { camera, controls } = sceneRef.current;

    if (initialCameraState) {
      const { pos, zoom, theta, phi } = initialCameraState;
      const [stx, sty, stz] = worldToScene(pos[0], pos[1], pos[2]);
      const clampedZoom = Math.min(zoom, controls.maxDistance);
      controls.target.set(stx, sty, stz);
      const thetaRad = THREE.MathUtils.degToRad(theta);
      const phiRad = THREE.MathUtils.degToRad(Math.min(phi, 88));
      const dx = clampedZoom * Math.sin(phiRad) * Math.cos(thetaRad);
      const dy = clampedZoom * Math.sin(phiRad) * Math.sin(thetaRad);
      const dz = clampedZoom * Math.cos(phiRad);
      camera.position.set(stx + dx, sty + dy, stz + dz);
      controls.update();
    } else {
      const startPos = worldData.worldData?.spawn;
      if (startPos) {
        const [sx, sy, sz] = worldToScene(startPos[0], startPos[1], startPos[2]);
        const baseZoom = Math.hypot(DEFAULT_START_OFFSET_Y, DEFAULT_START_OFFSET_Z);
        const targetZoom = INITIAL_CAMERA_ZOOM;
        const zoomScale = targetZoom / baseZoom;
        camera.position.set(
          sx,
          sy - DEFAULT_START_OFFSET_Y * zoomScale,
          sz + DEFAULT_START_OFFSET_Z * zoomScale,
        );
        controls.target.set(sx, sy, sz);
        controls.update();
      }
    }

    addSpawnMarker();
    updatePlayerMarkers();

    checkAndUpdateLOD(camera, controls);
  }, [worldData.loading, worldData.surfaceIndex, worldData.chunkIndex]);

  useEffect(() => {
    return () => {
      onChunkStatsChangeRef.current({
        loading: 0,
        loaded: 0,
        fps: 0,
        focusLod: 1,
        mode: modeRef.current,
        loadingBreakdown: {
          terrain: 0,
          voxels: 0,
          fetchQueue: 0,
          meshQueue: 0,
        },
        voxelHealth: {
          missing: 0,
          failed: 0,
        },
        loadedByLod: {},
      });
    };
  }, []);

  useEffect(() => {
    surfaceIndexRef.current = worldData.surfaceIndex;
    if (mode === "terrain" && sceneRef.current) {
      checkAndUpdateLOD(sceneRef.current.camera, sceneRef.current.controls);
    }
  }, [worldData.surfaceIndex, mode]);

  useEffect(() => {
    chunkIndexRef.current = worldData.chunkIndex;
    if (mode === "voxel") {
      missingVoxelsRef.current.clear();
      failedVoxelsRef.current.clear();
      if (sceneRef.current) {
        checkAndUpdateLOD(sceneRef.current.camera, sceneRef.current.controls);
      }
    }
  }, [worldData.chunkIndex, mode]);

  useEffect(() => {
    updatePlayerMarkers();
  }, [players]);

  useEffect(() => {
    if (markerGroupRef.current) markerGroupRef.current.visible = showPlayers;
  }, [showPlayers]);

  useEffect(() => {
    if (spawnGroupRef.current) spawnGroupRef.current.visible = showSpawn;
  }, [showSpawn]);

  useEffect(() => {
    if (chunkBorderGroupRef.current) chunkBorderGroupRef.current.visible = showChunkBorders;
  }, [showChunkBorders]);

  useEffect(() => {
    if (terrainGroupRef.current) {
      terrainGroupRef.current.visible = mode === "terrain" && showTerrain;
    }
    if (voxelGroupRef.current) {
      voxelGroupRef.current.visible = mode === "voxel";
    }
    terrainVisibilityDirtyRef.current = true;
    debugLabelsDirtyRef.current = true;
    biomeLabelsDirtyRef.current = true;
  }, [mode, showTerrain]);

  useEffect(() => {
    const group = debugLabelGroupRef.current;
    if (group) {
      group.visible = showChunkBorders || (showVoxelHeightLabels && mode === "voxel");
    }
    debugLabelsDirtyRef.current = true;
    if (sceneRef.current) {
      refreshDebugLabels();
    }
  }, [showChunkBorders, showVoxelHeightLabels, mode]);

  useEffect(() => {
    const group = biomeLabelGroupRef.current;
    if (group) group.visible = showBiomeLabels;
    biomeLabelsDirtyRef.current = true;
    if (!showBiomeLabels && sceneRef.current) {
      clearBiomeLabels();
    }
    if (showBiomeLabels && sceneRef.current) {
      void refreshBiomeLabels(sceneRef.current.controls.target);
    }
  }, [showBiomeLabels, mode]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (mode === "terrain") {
      clearVoxelTiles();
      debugLabelsDirtyRef.current = true;
      biomeLabelsDirtyRef.current = true;
    } else {
      clearTerrainTiles();
      debugLabelsDirtyRef.current = true;
      biomeLabelsDirtyRef.current = true;
    }

    checkAndUpdateLOD(scene.camera, scene.controls);
  }, [mode]);

  useEffect(() => {
    const unsubTile = subscribe("tile-updated", (event) => {
      if (!event.data) return;
      const { lod, tileX, tileY } = event.data as { lod: number; tileX: number; tileY: number };
      handleTileUpdate(lod, tileX, tileY);
    });

    const unsubRegion = subscribe("region-updated", (event) => {
      if (!event.data) return;
      const {
        lod,
        regionX,
        regionY,
      } = event.data as { lod?: number; regionX: number; regionY: number };
      handleRegionUpdate(lod ?? 1, regionX, regionY);
    });

    const unsubBatch = subscribe("terrain-updates-batch", (event) => {
      if (event.type !== "terrain-updates-batch") return;
      const batch = event as TerrainUpdatesBatchEvent;
      for (const tile of batch.data.tiles) {
        handleTileUpdate(tile.lod, tile.tileX, tile.tileY);
      }
      for (const region of batch.data.regions) {
        handleRegionUpdate((region as { lod?: number }).lod ?? 1, region.regionX, region.regionY);
      }
    });

    return () => {
      unsubTile();
      unsubRegion();
      unsubBatch();
    };
  }, [subscribe]);

  useEffect(() => {
    if (!flyToRequest || !sceneRef.current) return;
    const { camera, controls } = sceneRef.current;
    const [wx, wy, wz] = flyToRequest.pos;
    const [sx, sy, sz] = worldToScene(wx, wy, wz);
    const offset = camera.position.clone().sub(controls.target);
    controls.target.set(sx, sy, sz);
    camera.position.copy(controls.target).add(offset);
    controls.update();
  }, [flyToRequest]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        background: "#1a1a2e",
      }}
    />
  );
}
