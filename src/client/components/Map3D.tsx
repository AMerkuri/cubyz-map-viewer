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
import type { ChunkIndexEntry, SurfaceIndexEntry } from "../hooks/useWorldData.js";

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
  version: number;
  quadrantMeshes: WorkerQuadrantMesh[];
  chunkCoverage: number;
  chunkTopHeights: Float32Array;
  voxelSize: number;
  minZ: number;
  maxZ: number;
}

interface WorkerQuadrantMesh {
  quadrantIndex: number;
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

interface PendingVoxelFetchRequest {
  key: string;
  lod: number;
  regionX: number;
  regionY: number;
  priority: number;
  generation: number;
  version: number;
}

interface WorkerOut {
  lod?: number;
  regionX: number;
  regionY: number;
  version?: number;
  quadrantMeshes?: WorkerQuadrantMesh[];
  chunkCoverage?: number;
  chunkTopHeights?: Float32Array;
  voxelSize?: number;
  minZ?: number;
  maxZ?: number;
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
    quadrantIndex: number;
    mesh: THREE.Mesh;
  }[];
  minZ: number;
  maxZ: number;
  chunkCoverage: number;
  chunkTopHeights: Float32Array;
  borderLines: THREE.LineSegments;
}

interface ChunkStatsPayload {
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
  memoryBytes: number;
  memoryBreakdown: {
    terrain: number;
    voxels: number;
    cached: number;
    queued: number;
  };
  memoryByLod: Partial<Record<1 | 2 | 4 | 8 | 16 | 32, number>>;
  jsHeapBytes: number | null;
  warmCacheCount: number;
}

interface WarmCachedVoxelTile {
  tile: LoadedVoxelTile;
  bytes: number;
}

interface VoxelRefreshState {
  version: number;
  stale: boolean;
}

interface PerformanceMemoryInfo {
  usedJSHeapSize: number;
}

interface VoxelFocusState {
  point: THREE.Vector3;
  zoomDist: number;
  lastHitAt: number;
  initialized: boolean;
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
  showVoxelTerrain: boolean;
  showBiomeLabels: boolean;
  showVoxelHeightLabels: boolean;
  voxelLod1MaxDist: number;
  onCursorMove: (pos: [number, number, number] | null) => void;
  onChunkStatsChange: (stats: ChunkStatsPayload) => void;
  initialCameraState: InitialCameraState | null;
  onShareStateChange: (state: { mode: "terrain" | "voxel"; pos: [number, number, number]; zoom: number; theta: number; phi: number }) => void;
  flyToRequest: { pos: [number, number, number]; key: number } | null;
}

const LOD_LEVELS = [1, 2, 4, 8, 16, 32];
const FULL_VOXEL_QUADRANT_MASK = 0b1111;

const LOD_BORDER_COLORS: Record<number, { line: number; label: string }> = {
  1: { line: 0x44ff66, label: "#44ff66" },
  2: { line: 0x88ff44, label: "#88ff44" },
  4: { line: 0xffdd44, label: "#ffdd44" },
  8: { line: 0xffaa33, label: "#ffaa33" },
  16: { line: 0xff6633, label: "#ff6633" },
  32: { line: 0xff3344, label: "#ff3344" },
};

const TERRAIN_LOD_DISTANCE_THRESHOLDS = [
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
const VOXEL_FOCUS_STICKY_MS = 1500;
const VOXEL_FOCUS_SMOOTH_ALPHA = 0.6;
const VOXEL_LOD_HYSTERESIS_RATIO = 0.12;
const VOXEL_DETAIL_REQUEST_DEBOUNCE_MS = 180;
const VOXEL_UNLOAD_GRACE_MS = 750;
const VOXEL_MESH_BUILD_BUDGET_MS = 5;
const MAX_VOXEL_MESHES_PER_FRAME = 8;
const WARM_VOXEL_CACHE_MAX_BYTES = 512 * 1024 * 1024;
const INITIAL_CAMERA_ZOOM = 1500;
const DEFAULT_START_OFFSET_Y = 400;
const DEFAULT_START_OFFSET_Z = 300;

const VOXEL_REGION_CELLS = 128;
const VOXEL_CHUNK_CELLS = 32;
const TERRAIN_SKIRT_DEPTH = 32;
const TERRAIN_UNDERLAY_OFFSET_Z = -6;
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

function shouldRenderTerrainForMode(
  mode: "terrain" | "voxel",
  showTerrain: boolean,
  showVoxelTerrain: boolean,
): boolean {
  return mode === "terrain" ? showTerrain : showVoxelTerrain;
}

function createVoxelLodDistanceThresholds(lod1MaxDist: number): { maxDist: number; lod: number }[] {
  return [
    { lod: 1, maxDist: lod1MaxDist },
    { lod: 2, maxDist: 1200 },
    { lod: 4, maxDist: 2400 },
    { lod: 8, maxDist: 4800 },
    { lod: 16, maxDist: 9600 },
    { lod: 32, maxDist: Infinity },
  ];
}

function getLodForDistance(dist: number, thresholds: { maxDist: number; lod: number }[]): number {
  for (const threshold of thresholds) {
    if (dist <= threshold.maxDist) return threshold.lod;
  }
  return 32;
}

function getUnloadDistForLod(lod: number, thresholds: { maxDist: number; lod: number }[]): number {
  const entry = thresholds.find((t) => t.lod === lod);
  if (!entry || entry.maxDist === Infinity) return Infinity;
  return entry.maxDist * LOD_UNLOAD_HYSTERESIS;
}

function getLodForDistanceWithHysteresis(
  dist: number,
  previousLod: number,
  thresholds: { maxDist: number; lod: number }[],
): number {
  const previousIndex = LOD_LEVELS.indexOf(previousLod);
  if (previousIndex === -1) return getLodForDistance(dist, thresholds);

  const previousMinBase = previousIndex > 0
    ? (thresholds[previousIndex - 1]?.maxDist ?? 0)
    : 0;
  const previousMax = thresholds[previousIndex]?.maxDist ?? Infinity;
  const stickMin = previousMinBase * (1 - VOXEL_LOD_HYSTERESIS_RATIO);
  const stickMax = Number.isFinite(previousMax)
    ? previousMax * (1 + VOXEL_LOD_HYSTERESIS_RATIO)
    : Infinity;

  if (dist >= stickMin && dist <= stickMax) {
    return previousLod;
  }

  return getLodForDistance(dist, thresholds);
}

function clampDistanceToLodRange(dist: number, lod: number, thresholds: { maxDist: number; lod: number }[]): number {
  const lodIndex = LOD_LEVELS.indexOf(lod);
  if (lodIndex === -1) return dist;

  const lowerBase = lodIndex > 0
    ? (thresholds[lodIndex - 1]?.maxDist ?? 0)
    : 0;
  const upperBase = thresholds[lodIndex]?.maxDist ?? Infinity;

  const lower = lodIndex > 0 ? lowerBase + 0.001 : 0;
  const upper = Number.isFinite(upperBase) ? upperBase - 0.001 : Infinity;
  return Math.min(Math.max(dist, lower), upper);
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

function estimateGeometryBytes(geometry: THREE.BufferGeometry): number {
  let total = 0;

  for (const attr of Object.values(geometry.attributes)) {
    total += attr.array.byteLength;
  }

  if (geometry.index) {
    total += geometry.index.array.byteLength;
  }

  return total;
}

function estimateLoadedVoxelTileBytes(tile: LoadedVoxelTile): number {
  let total = tile.chunkTopHeights.byteLength + estimateGeometryBytes(tile.borderLines.geometry);
  for (const sm of tile.subMeshes) {
    total += estimateGeometryBytes(sm.mesh.geometry);
  }
  return total;
}

function addMemoryToLod(
  target: Partial<Record<1 | 2 | 4 | 8 | 16 | 32, number>>,
  lod: 1 | 2 | 4 | 8 | 16 | 32,
  bytes: number,
) {
  target[lod] = (target[lod] ?? 0) + bytes;
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

function buildVoxelQuadrantSubMeshes(item: PendingVoxelMeshItem): {
  subMeshes: {
    quadrantIndex: number;
    mesh: THREE.Mesh;
  }[];
  minZ: number;
  maxZ: number;
} {
  const subMeshes: {
    quadrantIndex: number;
    mesh: THREE.Mesh;
  }[] = [];

  for (const quadrant of item.quadrantMeshes) {
    if (quadrant.indices.length === 0) continue;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(quadrant.positions, 3));
    geom.setAttribute("normal", new THREE.BufferAttribute(quadrant.normals, 3));
    geom.setAttribute("color", new THREE.BufferAttribute(quadrant.colors, 3));
    geom.setIndex(new THREE.BufferAttribute(quadrant.indices, 1));
    geom.computeBoundingBox();
    geom.computeBoundingSphere();

    const mesh = new THREE.Mesh(geom, voxelMaterial);
    subMeshes.push({
      quadrantIndex: quadrant.quadrantIndex,
      mesh,
    });
  }

  return { subMeshes, minZ: item.minZ, maxZ: item.maxZ };
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

function voxelQuadrantBit(quadrant: number): number {
  return 1 << quadrant;
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
  showVoxelTerrain,
  showBiomeLabels,
  showVoxelHeightLabels,
  voxelLod1MaxDist,
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
  const warmCachedVoxelsRef = useRef<Map<string, WarmCachedVoxelTile>>(new Map());
  const warmCachedVoxelBytesRef = useRef(0);
  const loadingVoxelsRef = useRef<Set<string>>(new Set());
  const missingVoxelsRef = useRef<Set<string>>(new Set());
  const failedVoxelsRef = useRef<Map<string, number>>(new Map());
  const pendingVoxelFetchQueueRef = useRef<PendingVoxelFetchRequest[]>([]);
  const activeVoxelFetchCountRef = useRef(0);
  const voxelFetchControllersRef = useRef<Map<string, AbortController>>(new Map());
  const voxelRefreshStatesRef = useRef<Map<string, VoxelRefreshState>>(new Map());
  const activeVoxelRequestKeysRef = useRef<Set<string>>(new Set());
  const activeVoxelRequestGenerationRef = useRef(0);
  const pendingVoxelDetailRequestsRef = useRef<Map<string, PendingVoxelFetchRequest>>(new Map());
  const committedVoxelDetailRequestsRef = useRef<Map<string, PendingVoxelFetchRequest>>(new Map());
  const voxelUnloadGraceUntilRef = useRef<Map<string, number>>(new Map());
  const voxelLastCameraSampleRef = useRef<{ camera: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  const voxelLastMotionAtRef = useRef(0);
  const pendingVoxelMeshQueueRef = useRef<PendingVoxelMeshItem[]>([]);
  const workerRef = useRef<Worker | null>(null);

  const surfaceIndexRef = useRef<SurfaceIndexEntry[]>([]);
  const chunkIndexRef = useRef(worldData.chunkIndex);
  const availableVoxelKeysRef = useRef<Set<string>>(new Set());
  const voxelRootEntriesRef = useRef<ChunkIndexEntry[]>([]);

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
  const showVoxelTerrainRef = useRef(showVoxelTerrain);
  showVoxelTerrainRef.current = showVoxelTerrain;
  const showBiomeLabelsRef = useRef(showBiomeLabels);
  showBiomeLabelsRef.current = showBiomeLabels;
  const showVoxelHeightLabelsRef = useRef(showVoxelHeightLabels);
  showVoxelHeightLabelsRef.current = showVoxelHeightLabels;
  const voxelLodThresholdsRef = useRef(createVoxelLodDistanceThresholds(voxelLod1MaxDist));
  voxelLodThresholdsRef.current = createVoxelLodDistanceThresholds(voxelLod1MaxDist);

  const keysHeldRef = useRef<Set<string>>(new Set());
  const terrainVisibilityDirtyRef = useRef(false);
  const debugLabelsDirtyRef = useRef(false);
  const biomeLabelsDirtyRef = useRef(false);
  const biomeRefreshTokenRef = useRef(0);
  const lastChunkStatsRef = useRef("");
  const activeFocusLodRef = useRef<number>(1);
  const voxelFocusStateRef = useRef<VoxelFocusState>({
    point: new THREE.Vector3(),
    zoomDist: 0,
    lastHitAt: 0,
    initialized: false,
  });

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

  function hasAllImmediateFinerTerrainChildrenLoaded(tile: LoadedTerrainTile): boolean {
    if (tile.lod <= 1) return false;
    const finerLod = tile.lod / 2;
    for (let ox = 0; ox <= 1; ox++) {
      for (let oy = 0; oy <= 1; oy++) {
        const childKey = terrainTileKey(finerLod, tile.tileX * 2 + ox, tile.tileY * 2 + oy);
        if (!loadedTerrainRef.current.has(childKey)) return false;
      }
    }
    return true;
  }

  function voxelTileKeyAtWorld(lod: number, worldXPos: number, worldYPos: number): string {
    const size = regionWorldSize(lod);
    const regionX = Math.floor(worldXPos / size) * size;
    const regionY = Math.floor(worldYPos / size) * size;
    return voxelTileKey(lod, regionX, regionY);
  }

  function getVoxelParentRegion(lod: number, regionX: number, regionY: number): ChunkIndexEntry | null {
    const parentLod = lod * 2;
    if (!LOD_LEVELS.includes(parentLod)) return null;

    const parentSize = regionWorldSize(parentLod);
    return {
      lod: parentLod,
      regionX: Math.floor(regionX / parentSize) * parentSize,
      regionY: Math.floor(regionY / parentSize) * parentSize,
    };
  }

  function getImmediateFinerVoxelChildren(lod: number, regionX: number, regionY: number): ChunkIndexEntry[] {
    if (lod <= 1) return [];

    const childLod = lod / 2;
    const childSize = regionWorldSize(childLod);
    return [
      { lod: childLod, regionX, regionY },
      { lod: childLod, regionX: regionX + childSize, regionY },
      { lod: childLod, regionX, regionY: regionY + childSize },
      { lod: childLod, regionX: regionX + childSize, regionY: regionY + childSize },
    ];
  }

  function rebuildVoxelIndexCache(entries: ChunkIndexEntry[]) {
    const availableKeys = new Set<string>();
    for (const entry of entries) {
      availableKeys.add(voxelTileKey(entry.lod, entry.regionX, entry.regionY));
    }

    const roots: ChunkIndexEntry[] = [];
    for (const entry of entries) {
      const parent = getVoxelParentRegion(entry.lod, entry.regionX, entry.regionY);
      if (!parent || !availableKeys.has(voxelTileKey(parent.lod, parent.regionX, parent.regionY))) {
        roots.push(entry);
      }
    }

    roots.sort((a, b) => b.lod - a.lod || a.regionX - b.regionX || a.regionY - b.regionY);
    availableVoxelKeysRef.current = availableKeys;
    voxelRootEntriesRef.current = roots;
  }

  function hasLoadedTerrainTileAtWorld(lod: number, worldXPos: number, worldYPos: number): boolean {
    return loadedTerrainRef.current.has(terrainTileKeyAtWorld(lod, worldXPos, worldYPos));
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

  function detachVoxelTileFromScene(tile: LoadedVoxelTile) {
    for (const sm of tile.subMeshes) {
      voxelGroupRef.current?.remove(sm.mesh);
      sm.mesh.visible = false;
    }
    chunkBorderGroupRef.current?.remove(tile.borderLines);
    tile.borderLines.visible = false;
  }

  function attachVoxelTileToScene(tile: LoadedVoxelTile) {
    for (const sm of tile.subMeshes) {
      sm.mesh.visible = false;
      voxelGroupRef.current?.add(sm.mesh);
    }
    tile.borderLines.visible = false;
    chunkBorderGroupRef.current?.add(tile.borderLines);
  }

  function disposeVoxelTileResources(tile: LoadedVoxelTile) {
    detachVoxelTileFromScene(tile);
    for (const sm of tile.subMeshes) {
      sm.mesh.geometry.dispose();
    }
    tile.borderLines.geometry.dispose();
    (tile.borderLines.material as THREE.Material).dispose();
  }

  function evictWarmCachedVoxelTile(key: string) {
    const cached = warmCachedVoxelsRef.current.get(key);
    if (!cached) return;
    warmCachedVoxelsRef.current.delete(key);
    warmCachedVoxelBytesRef.current = Math.max(0, warmCachedVoxelBytesRef.current - cached.bytes);
    disposeVoxelTileResources(cached.tile);
  }

  function trimWarmVoxelCache() {
    while (warmCachedVoxelBytesRef.current > WARM_VOXEL_CACHE_MAX_BYTES) {
      const oldest = warmCachedVoxelsRef.current.keys().next().value;
      if (!oldest) break;
      evictWarmCachedVoxelTile(oldest);
    }
  }

  function moveVoxelTileToWarmCache(tile: LoadedVoxelTile) {
    const bytes = estimateLoadedVoxelTileBytes(tile);
    detachVoxelTileFromScene(tile);

    const existing = warmCachedVoxelsRef.current.get(tile.key);
    if (existing) {
      warmCachedVoxelBytesRef.current = Math.max(0, warmCachedVoxelBytesRef.current - existing.bytes);
      disposeVoxelTileResources(existing.tile);
      warmCachedVoxelsRef.current.delete(tile.key);
    }

    warmCachedVoxelsRef.current.set(tile.key, { tile, bytes });
    warmCachedVoxelBytesRef.current += bytes;
    trimWarmVoxelCache();
  }

  function restoreVoxelTileFromWarmCache(key: string): LoadedVoxelTile | null {
    if (isVoxelTileStale(key)) return null;
    const cached = warmCachedVoxelsRef.current.get(key);
    if (!cached) return null;

    warmCachedVoxelsRef.current.delete(key);
    warmCachedVoxelBytesRef.current = Math.max(0, warmCachedVoxelBytesRef.current - cached.bytes);
    attachVoxelTileToScene(cached.tile);
    return cached.tile;
  }

  function unloadVoxelTile(key: string, preserveWarmCache = true) {
    const vt = loadedVoxelsRef.current.get(key);
    if (!vt) return;
    loadedVoxelsRef.current.delete(key);
    loadingVoxelsRef.current.delete(key);
    voxelUnloadGraceUntilRef.current.delete(key);

    if (preserveWarmCache) {
      moveVoxelTileToWarmCache(vt);
      return;
    }

    disposeVoxelTileResources(vt);
  }

  function clearVoxelTiles(preserveWarmCache = false) {
    for (const key of loadedVoxelsRef.current.keys()) {
      unloadVoxelTile(key, preserveWarmCache);
    }
    for (const controller of voxelFetchControllersRef.current.values()) {
      controller.abort();
    }
    voxelFetchControllersRef.current.clear();
    loadedVoxelsRef.current.clear();
    loadingVoxelsRef.current.clear();
    missingVoxelsRef.current.clear();
    failedVoxelsRef.current.clear();
    activeVoxelRequestKeysRef.current.clear();
    voxelRefreshStatesRef.current.clear();
    pendingVoxelDetailRequestsRef.current.clear();
    committedVoxelDetailRequestsRef.current.clear();
    voxelUnloadGraceUntilRef.current.clear();
    voxelLastCameraSampleRef.current = null;
    voxelLastMotionAtRef.current = 0;
    pendingVoxelFetchQueueRef.current = [];
    pendingVoxelMeshQueueRef.current = [];
    activeVoxelFetchCountRef.current = 0;

    if (!preserveWarmCache) {
      for (const key of [...warmCachedVoxelsRef.current.keys()]) {
        evictWarmCachedVoxelTile(key);
      }
      warmCachedVoxelsRef.current.clear();
      warmCachedVoxelBytesRef.current = 0;
    }
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

  async function loadTerrainTile(
    lod: number,
    tileX: number,
    tileY: number,
    options: { replaceExisting?: boolean } = {},
  ) {
    const replaceExisting = options.replaceExisting === true;
    const key = terrainTileKey(lod, tileX, tileY);
    if (loadingTerrainRef.current.has(key)) return;
    if (!replaceExisting && loadedTerrainRef.current.has(key)) return;
    loadingTerrainRef.current.add(key);

    try {
      const data = await fetchTerrain(lod, tileX, tileY);
      if (!data || !terrainGroupRef.current) return;
      const current = loadedTerrainRef.current.get(key);
      if (current && !replaceExisting) return;

      const mesh = buildFullTileMesh(data);
      const border = buildSurfaceTileBorderLines(data.worldX, data.worldY, lod, mesh);
      const renderTerrain = shouldRenderTerrainForMode(
        modeRef.current,
        showTerrainRef.current,
        showVoxelTerrainRef.current,
      );
      mesh.visible = renderTerrain;
      border.lines.visible = modeRef.current === "terrain" && showChunkBordersRef.current && renderTerrain;
      border.label.visible = modeRef.current === "terrain" && showChunkBordersRef.current && renderTerrain;

      terrainGroupRef.current.add(mesh);
      chunkBorderGroupRef.current?.add(border.lines);
      chunkBorderGroupRef.current?.add(border.label);

      if (current) {
        disposeTerrainTile(current);
      }

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

  function updateTerrainVisibility(target: THREE.Vector3, camDist: number) {
    const renderTerrain = shouldRenderTerrainForMode(
      modeRef.current,
      showTerrainRef.current,
      showVoxelTerrainRef.current,
    );
    let changed = false;

    for (const tile of loadedTerrainRef.current.values()) {
      const tileWorldSize = 256 * tile.lod;
      const centerWorldX = tile.worldX + tileWorldSize / 2;
      const centerWorldY = tile.worldY + tileWorldSize / 2;
      const centerSceneY = -centerWorldY;
      const dx = centerWorldX - target.x;
      const dy = centerSceneY - target.y;
      const xyDist = Math.sqrt(dx * dx + dy * dy);
      const dist = Math.max(xyDist, camDist);

      const desiredLod = getLodForDistance(dist, TERRAIN_LOD_DISTANCE_THRESHOLDS);
      let replacedByPriority = false;
      if (desiredLod > tile.lod) {
        replacedByPriority = hasLoadedTerrainTileAtWorld(desiredLod, centerWorldX, centerWorldY);
      } else if (desiredLod < tile.lod) {
        replacedByPriority = hasAllImmediateFinerTerrainChildrenLoaded(tile);
      }

      const visible = renderTerrain && !replacedByPriority;

      if (tile.mesh.visible !== visible) {
        tile.mesh.visible = visible;
        changed = true;
      }
      tile.borderLines.visible = modeRef.current === "terrain" && showChunkBordersRef.current && visible;
      tile.borderLabel.visible = modeRef.current === "terrain" && showChunkBordersRef.current && visible;
    }

    if (changed) {
      debugLabelsDirtyRef.current = true;
      biomeLabelsDirtyRef.current = true;
    }
  }

  function compareVoxelFetchRequests(a: PendingVoxelFetchRequest, b: PendingVoxelFetchRequest): number {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.generation - a.generation;
  }

  function queueVoxelFetchRequest(request: PendingVoxelFetchRequest) {
    const existingIndex = pendingVoxelFetchQueueRef.current.findIndex((item) => item.key === request.key);
    if (existingIndex !== -1) {
      pendingVoxelFetchQueueRef.current[existingIndex] = request;
    } else {
      pendingVoxelFetchQueueRef.current.push(request);
    }
    pendingVoxelFetchQueueRef.current.sort(compareVoxelFetchRequests);
  }

  function getVoxelRefreshVersion(key: string): number {
    return voxelRefreshStatesRef.current.get(key)?.version ?? 0;
  }

  function markVoxelTileStale(key: string): number {
    const nextVersion = getVoxelRefreshVersion(key) + 1;
    voxelRefreshStatesRef.current.set(key, { version: nextVersion, stale: true });
    return nextVersion;
  }

  function markVoxelTileFresh(key: string, version: number) {
    const current = voxelRefreshStatesRef.current.get(key);
    if (!current || version >= current.version) {
      voxelRefreshStatesRef.current.set(key, { version, stale: false });
    }
  }

  function isVoxelTileStale(key: string): boolean {
    return voxelRefreshStatesRef.current.get(key)?.stale === true;
  }

  function finishVoxelFetch(key: string) {
    voxelFetchControllersRef.current.delete(key);
    activeVoxelFetchCountRef.current = Math.max(0, activeVoxelFetchCountRef.current - 1);
    drainVoxelFetchQueue();
  }

  function requestDirectVoxelRefresh(lod: number, regionX: number, regionY: number, version: number) {
    const key = voxelTileKey(lod, regionX, regionY);
    if (!workerRef.current) return;

    const retries = failedVoxelsRef.current.get(key);
    if (retries !== undefined && retries >= MAX_VOXEL_RETRIES) return;

    voxelFetchControllersRef.current.get(key)?.abort();
    if (voxelFetchControllersRef.current.has(key)) return;

    activeVoxelFetchCountRef.current++;
    loadingVoxelsRef.current.add(key);
    const controller = new AbortController();
    voxelFetchControllersRef.current.set(key, controller);

    void fetchVoxelRegion(
      {
        key,
        lod,
        regionX,
        regionY,
        priority: Number.NEGATIVE_INFINITY,
        generation: activeVoxelRequestGenerationRef.current,
        version,
      },
      controller,
    );
  }

  function requestVoxelRegion(request: PendingVoxelFetchRequest) {
    const { key } = request;
    if (loadedVoxelsRef.current.has(key) && !isVoxelTileStale(key)) return;

    const restored = restoreVoxelTileFromWarmCache(key);
    if (restored) {
      loadedVoxelsRef.current.set(key, restored);
      voxelUnloadGraceUntilRef.current.set(key, performance.now() + VOXEL_UNLOAD_GRACE_MS);
      markVoxelTileFresh(key, request.version);
      debugLabelsDirtyRef.current = true;
      return;
    }

    if (missingVoxelsRef.current.has(key)) return;

    const retries = failedVoxelsRef.current.get(key);
    if (retries !== undefined && retries >= MAX_VOXEL_RETRIES) return;
    if (!workerRef.current) return;

    if (voxelFetchControllersRef.current.has(key)) return;

    if (loadingVoxelsRef.current.has(key)) {
      if (pendingVoxelMeshQueueRef.current.some((item) => item.key === key)) return;
      queueVoxelFetchRequest(request);
      return;
    }

    loadingVoxelsRef.current.add(key);
    queueVoxelFetchRequest(request);
  }

  function drainVoxelFetchQueue() {
    pendingVoxelFetchQueueRef.current.sort(compareVoxelFetchRequests);

    while (
      activeVoxelFetchCountRef.current < MAX_CONCURRENT_VOXEL_FETCHES
      && pendingVoxelFetchQueueRef.current.length > 0
    ) {
      const next = pendingVoxelFetchQueueRef.current.shift()!;
      if (!activeVoxelRequestKeysRef.current.has(next.key)) {
        loadingVoxelsRef.current.delete(next.key);
        continue;
      }
      if ((loadedVoxelsRef.current.has(next.key) && !isVoxelTileStale(next.key)) || missingVoxelsRef.current.has(next.key)) {
        loadingVoxelsRef.current.delete(next.key);
        continue;
      }

      const retries = failedVoxelsRef.current.get(next.key);
      if (retries !== undefined && retries >= MAX_VOXEL_RETRIES) {
        loadingVoxelsRef.current.delete(next.key);
        continue;
      }
      if (voxelFetchControllersRef.current.has(next.key)) {
        continue;
      }
      if (!loadingVoxelsRef.current.has(next.key)) {
        continue;
      }

      activeVoxelFetchCountRef.current++;
      const controller = new AbortController();
      voxelFetchControllersRef.current.set(next.key, controller);
      void fetchVoxelRegion(next, controller);
    }
  }

  function syncVoxelRequests(requests: Map<string, PendingVoxelFetchRequest>) {
    activeVoxelRequestKeysRef.current = new Set(requests.keys());

    pendingVoxelFetchQueueRef.current = pendingVoxelFetchQueueRef.current.filter((item) => {
      const updated = requests.get(item.key);
      if (!updated || (loadedVoxelsRef.current.has(item.key) && !isVoxelTileStale(item.key))) {
        loadingVoxelsRef.current.delete(item.key);
        return false;
      }
      item.priority = updated.priority;
      item.generation = updated.generation;
      item.version = updated.version;
      return true;
    });
    pendingVoxelFetchQueueRef.current.sort(compareVoxelFetchRequests);

    pendingVoxelMeshQueueRef.current = pendingVoxelMeshQueueRef.current.filter((item) => {
      if (item.version < getVoxelRefreshVersion(item.key)) {
        return false;
      }
      if (activeVoxelRequestKeysRef.current.has(item.key) || loadedVoxelsRef.current.has(item.key)) {
        return true;
      }
      loadingVoxelsRef.current.delete(item.key);
      return false;
    });

    for (const [key, controller] of voxelFetchControllersRef.current) {
      if (!activeVoxelRequestKeysRef.current.has(key)) {
        controller.abort();
      }
    }

    for (const request of requests.values()) {
      requestVoxelRegion(request);
    }

    drainVoxelFetchQueue();
  }

  async function fetchVoxelRegion(request: PendingVoxelFetchRequest, controller: AbortController) {
    const { key, lod, regionX, regionY, version } = request;

    try {
      const res = await fetch(`/api/voxels/${lod}/${regionX}/${regionY}`, { signal: controller.signal });
      if (!activeVoxelRequestKeysRef.current.has(key) && !(loadedVoxelsRef.current.has(key) && isVoxelTileStale(key))) {
        loadingVoxelsRef.current.delete(key);
        return;
      }
      if (res.status === 204) {
        missingVoxelsRef.current.add(key);
        loadingVoxelsRef.current.delete(key);
        return;
      }
      if (!res.ok) {
        failedVoxelsRef.current.set(key, (failedVoxelsRef.current.get(key) ?? 0) + 1);
        loadingVoxelsRef.current.delete(key);
        return;
      }

      const buffer = await res.arrayBuffer();
      if (!workerRef.current || (!activeVoxelRequestKeysRef.current.has(key) && !(loadedVoxelsRef.current.has(key) && isVoxelTileStale(key)))) {
        loadingVoxelsRef.current.delete(key);
        return;
      }

      workerRef.current.postMessage({ buffer, lod, regionX, regionY, version }, [buffer]);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        loadingVoxelsRef.current.delete(key);
        return;
      }

      console.error(`Failed to load voxel region ${key}:`, e);
      if (activeVoxelRequestKeysRef.current.has(key)) {
        failedVoxelsRef.current.set(key, (failedVoxelsRef.current.get(key) ?? 0) + 1);
      }
      loadingVoxelsRef.current.delete(key);
    } finally {
      finishVoxelFetch(key);
    }
  }

  function updateVoxelLod(target: THREE.Vector3, camDist: number, focusLod: number) {
    const roots = voxelRootEntriesRef.current;
    if (roots.length === 0) {
      pendingVoxelDetailRequestsRef.current.clear();
      committedVoxelDetailRequestsRef.current.clear();
      syncVoxelRequests(new Map());
      return;
    }

    const now = performance.now();
    const voxelThresholds = voxelLodThresholdsRef.current;
    const requestGeneration = activeVoxelRequestGenerationRef.current + 1;
    activeVoxelRequestGenerationRef.current = requestGeneration;
    const yWorldTarget = -target.y;
    const fallbackMaxDist = (voxelThresholds[voxelThresholds.length - 2]?.maxDist ?? 9600) * 2;
    const visibleQuadrantMasks = new Map<string, number>();
    const coverageVoxelRequests = new Map<string, PendingVoxelFetchRequest>();
    const detailVoxelRequests = new Map<string, PendingVoxelFetchRequest>();
    const stableForDetail = now - voxelLastMotionAtRef.current >= VOXEL_DETAIL_REQUEST_DEBOUNCE_MS;

    const addVisibleQuadrant = (key: string, quadrant: number) => {
      visibleQuadrantMasks.set(key, (visibleQuadrantMasks.get(key) ?? 0) | voxelQuadrantBit(quadrant));
    };

    const getTileEffectiveDist = (lod: number, regionX: number, regionY: number): number => {
      const size = regionWorldSize(lod);
      const dx = target.x < regionX
        ? regionX - target.x
        : target.x > regionX + size
          ? target.x - (regionX + size)
          : 0;
      const dy = yWorldTarget < regionY
        ? regionY - yWorldTarget
        : yWorldTarget > regionY + size
          ? yWorldTarget - (regionY + size)
          : 0;
      return Math.max(Math.hypot(dx, dy), camDist);
    };

    const getSelectionDistForLod = (lod: number): number => {
      const unloadDist = getUnloadDistForLod(lod, voxelThresholds);
      return Number.isFinite(unloadDist) ? unloadDist : fallbackMaxDist;
    };

    const noteVoxelRequest = (
      requestMap: Map<string, PendingVoxelFetchRequest>,
      lod: number,
      regionX: number,
      regionY: number,
      effectiveDist: number,
    ) => {
      const key = voxelTileKey(lod, regionX, regionY);
      const request: PendingVoxelFetchRequest = {
        key,
        lod,
        regionX,
        regionY,
        priority: LOD_LEVELS.indexOf(lod) * 100_000 + Math.round(effectiveDist),
        generation: requestGeneration,
        version: getVoxelRefreshVersion(key),
      };
      const existing = requestMap.get(key);
      if (!existing || compareVoxelFetchRequests(request, existing) < 0) {
        requestMap.set(key, request);
      }
    };

    const mergeVoxelRequest = (requestMap: Map<string, PendingVoxelFetchRequest>, request: PendingVoxelFetchRequest) => {
      const existing = requestMap.get(request.key);
      if (!existing || compareVoxelFetchRequests(request, existing) < 0) {
        requestMap.set(request.key, request);
      }
    };

    const selectVisibleTile = (entry: ChunkIndexEntry, hasLoadedFallback: boolean): boolean => {
      const key = voxelTileKey(entry.lod, entry.regionX, entry.regionY);
      const effectiveDist = getTileEffectiveDist(entry.lod, entry.regionX, entry.regionY);
      if (effectiveDist > getSelectionDistForLod(entry.lod)) return false;

      const desiredLod = getLodForDistanceWithHysteresis(effectiveDist, focusLod, voxelThresholds);
      const selfLoaded = loadedVoxelsRef.current.has(key);
      const selfStale = isVoxelTileStale(key);
      let hasSelectedCoverage = false;
      let needsSelfFallback = false;

      if (entry.lod > desiredLod) {
        const children = getImmediateFinerVoxelChildren(entry.lod, entry.regionX, entry.regionY);
        for (let quadrant = 0; quadrant < children.length; quadrant++) {
          const child = children[quadrant]!;
          const childKey = voxelTileKey(child.lod, child.regionX, child.regionY);
          const childAvailable = availableVoxelKeysRef.current.has(childKey);

          if (childAvailable && selectVisibleTile(child, hasLoadedFallback || selfLoaded)) {
              hasSelectedCoverage = true;
              continue;
          }

          needsSelfFallback = true;
          if (selfLoaded) {
            addVisibleQuadrant(key, quadrant);
            hasSelectedCoverage = true;
          }
        }
      } else {
        needsSelfFallback = true;
        if (selfLoaded) {
          visibleQuadrantMasks.set(key, FULL_VOXEL_QUADRANT_MASK);
          hasSelectedCoverage = true;
        }
      }

      if (needsSelfFallback) {
        if (!selfLoaded || selfStale) {
          noteVoxelRequest(hasLoadedFallback ? detailVoxelRequests : coverageVoxelRequests, entry.lod, entry.regionX, entry.regionY, effectiveDist);
        }
      }

      return hasSelectedCoverage;
    };

    for (const root of roots) {
      selectVisibleTile(root, false);
    }

    pendingVoxelDetailRequestsRef.current = detailVoxelRequests;
    committedVoxelDetailRequestsRef.current = stableForDetail ? detailVoxelRequests : new Map();

    const requestedVoxelRequests = new Map<string, PendingVoxelFetchRequest>();
    for (const request of coverageVoxelRequests.values()) {
      mergeVoxelRequest(requestedVoxelRequests, request);
    }
    for (const request of committedVoxelDetailRequestsRef.current.values()) {
      mergeVoxelRequest(requestedVoxelRequests, request);
    }

    syncVoxelRequests(requestedVoxelRequests);

    let changed = false;
    for (const [key, tile] of loadedVoxelsRef.current) {
      const quadrantMask = visibleQuadrantMasks.get(key) ?? 0;
      const visible = quadrantMask !== 0;
      const effectiveDist = getTileEffectiveDist(tile.lod, tile.regionX, tile.regionY);
      const unloadDist = getSelectionDistForLod(tile.lod) * 1.1;
      const keepLoaded = visible || coverageVoxelRequests.has(key) || detailVoxelRequests.has(key);

      if (keepLoaded) {
        voxelUnloadGraceUntilRef.current.set(key, now + VOXEL_UNLOAD_GRACE_MS);
      }

      if (tile.borderLines.visible !== visible) {
        tile.borderLines.visible = visible;
        changed = true;
      }

      for (const sm of tile.subMeshes) {
        const smVisible = (quadrantMask & voxelQuadrantBit(sm.quadrantIndex)) !== 0;
        if (sm.mesh.visible !== smVisible) {
          sm.mesh.visible = smVisible;
          changed = true;
        }
      }

      const graceUntil = voxelUnloadGraceUntilRef.current.get(key) ?? 0;
      const inGrace = now < graceUntil;

      if (!visible && !requestedVoxelRequests.has(key) && !inGrace) {
        unloadVoxelTile(key);
        changed = true;
        continue;
      }

      if (!requestedVoxelRequests.has(key) && !inGrace && effectiveDist > unloadDist) {
        unloadVoxelTile(key);
        changed = true;
      }
    }

    for (const key of [...loadingVoxelsRef.current]) {
      const parsed = parseVoxelKey(key);
      if (!parsed) continue;
      const effectiveDist = getTileEffectiveDist(parsed.lod, parsed.regionX, parsed.regionY);
      if (!requestedVoxelRequests.has(key) && effectiveDist > getSelectionDistForLod(parsed.lod) * 1.1) {
        loadingVoxelsRef.current.delete(key);
        pendingVoxelMeshQueueRef.current = pendingVoxelMeshQueueRef.current.filter((q) => q.key !== key);
      }
    }

    if (changed) {
      debugLabelsDirtyRef.current = true;
    }
  }

  async function refreshBiomeLabels(target: THREE.Vector3, camDist: number) {
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
          const xyDist = Math.hypot(centerX - target.x, -centerY - target.y);
          const dist = Math.max(xyDist, camDist);
          return {
            entry,
            dist,
            desiredLod: getLodForDistance(dist, TERRAIN_LOD_DISTANCE_THRESHOLDS),
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
    const shouldRenderTerrain = shouldRenderTerrainForMode(
      modeRef.current,
      showTerrainRef.current,
      showVoxelTerrainRef.current,
    );
    if (existing) {
      if (shouldRenderTerrain) {
        void loadTerrainTile(lod, tileX, tileY, { replaceExisting: true });
      } else {
        disposeTerrainTile(existing);
        loadedTerrainRef.current.delete(key);
        debugLabelsDirtyRef.current = true;
        biomeLabelsDirtyRef.current = true;
      }
    } else if (shouldRenderTerrain) {
      void loadTerrainTile(lod, tileX, tileY);
    }
  }

  function handleRegionUpdate(lod: number, regionX: number, regionY: number) {
    const key = voxelTileKey(lod, regionX, regionY);
    const version = markVoxelTileStale(key);
    missingVoxelsRef.current.delete(key);
    failedVoxelsRef.current.delete(key);
    evictWarmCachedVoxelTile(key);
    voxelFetchControllersRef.current.get(key)?.abort();
    pendingVoxelFetchQueueRef.current = pendingVoxelFetchQueueRef.current.filter((item) => item.key !== key);
    pendingVoxelMeshQueueRef.current = pendingVoxelMeshQueueRef.current.filter(
      (item) => item.key !== key || item.version >= getVoxelRefreshVersion(key)
    );
    loadingVoxelsRef.current.delete(key);
    if (modeRef.current === "voxel" && sceneRef.current) {
      checkAndUpdateLOD(sceneRef.current.camera, sceneRef.current.controls);
    }
    if (loadedVoxelsRef.current.has(key) || availableVoxelKeysRef.current.has(key)) {
      requestDirectVoxelRefresh(lod, regionX, regionY, version);
    }
    debugLabelsDirtyRef.current = true;
  }

  function resolveVoxelLodFocus(camera: THREE.PerspectiveCamera, controls: OrbitControls): {
    point: THREE.Vector3;
    zoomDist: number;
  } {
    const now = performance.now();
    const fallbackPoint = controls.target.clone();
    const fallbackZoomDist = camera.position.distanceTo(controls.target);
    const state = voxelFocusStateRef.current;

    let rawPoint = fallbackPoint;
    let rawZoomDist = fallbackZoomDist;
    let hadRayHit = false;

    const voxelGroup = voxelGroupRef.current;
    if (voxelGroup && voxelGroup.children.length > 0) {
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
      const intersections = raycaster.intersectObjects(voxelGroup.children, false);
      if (intersections.length > 0) {
        hadRayHit = true;
        rawPoint = intersections[0].point.clone();
        const hitZoomDist = camera.position.distanceTo(intersections[0].point);
        rawZoomDist = Math.min(fallbackZoomDist, hitZoomDist);
        state.lastHitAt = now;
      }
    }

    if (!hadRayHit && state.initialized && now - state.lastHitAt <= VOXEL_FOCUS_STICKY_MS) {
      rawPoint = state.point.clone();
      rawZoomDist = clampDistanceToLodRange(state.zoomDist, activeFocusLodRef.current, voxelLodThresholdsRef.current);
    }

    if (!state.initialized) {
      state.initialized = true;
      state.point.copy(rawPoint);
      state.zoomDist = rawZoomDist;
      return {
        point: rawPoint,
        zoomDist: rawZoomDist,
      };
    }

    state.point.lerp(rawPoint, VOXEL_FOCUS_SMOOTH_ALPHA);
    state.zoomDist = THREE.MathUtils.lerp(state.zoomDist, rawZoomDist, VOXEL_FOCUS_SMOOTH_ALPHA);

    return {
      point: state.point.clone(),
      zoomDist: state.zoomDist,
    };
  }

  function syncTerrainLod(target: THREE.Vector3, camDist: number) {
    const index = surfaceIndexRef.current;
    if (index.length > 0) {
      for (const entry of index) {
        const tileWorldSize = 256 * entry.lod;
        const centerX = entry.worldX + tileWorldSize / 2;
        const centerY = -(entry.worldY + tileWorldSize / 2);
        const xyDist = Math.hypot(centerX - target.x, centerY - target.y);
        const dist = Math.max(xyDist, camDist);
        const desiredLod = getLodForDistance(dist, TERRAIN_LOD_DISTANCE_THRESHOLDS);
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
      const xyDist = Math.hypot(centerWorldX - target.x, centerSceneY - target.y);
      const dist = Math.max(xyDist, camDist);
      const desiredLod = getLodForDistance(dist, TERRAIN_LOD_DISTANCE_THRESHOLDS);

      let replacedByPriority = false;
      if (desiredLod > tile.lod) {
        replacedByPriority = hasLoadedTerrainTileAtWorld(desiredLod, centerWorldX, centerWorldY);
      } else if (desiredLod < tile.lod) {
        replacedByPriority = hasAllImmediateFinerTerrainChildrenLoaded(tile);
      }

      if (replacedByPriority) {
        disposeTerrainTile(tile);
        loadedTerrainRef.current.delete(key);
        debugLabelsDirtyRef.current = true;
        biomeLabelsDirtyRef.current = true;
        continue;
      }
    }

    updateTerrainVisibility(target, camDist);
    terrainVisibilityDirtyRef.current = false;
  }

  function checkAndUpdateLOD(camera: THREE.PerspectiveCamera, controls: OrbitControls) {
    const target = controls.target;
    const camDist = camera.position.distanceTo(target);
    const now = performance.now();

    const lastCameraSample = voxelLastCameraSampleRef.current;
    if (
      !lastCameraSample
      || lastCameraSample.camera.distanceToSquared(camera.position) > 1
      || lastCameraSample.target.distanceToSquared(target) > 1
    ) {
      voxelLastMotionAtRef.current = now;
      if (lastCameraSample) {
        lastCameraSample.camera.copy(camera.position);
        lastCameraSample.target.copy(target);
      } else {
        voxelLastCameraSampleRef.current = {
          camera: camera.position.clone(),
          target: target.clone(),
        };
      }
    }

    const shouldRenderTerrain = shouldRenderTerrainForMode(
      modeRef.current,
      showTerrainRef.current,
      showVoxelTerrainRef.current,
    );

    if (modeRef.current === "terrain") {
      pendingVoxelDetailRequestsRef.current.clear();
      committedVoxelDetailRequestsRef.current.clear();
      syncVoxelRequests(new Map());
      activeFocusLodRef.current = getLodForDistance(camDist, TERRAIN_LOD_DISTANCE_THRESHOLDS);
      syncTerrainLod(target, camDist);
    } else {
      if (shouldRenderTerrain) {
        syncTerrainLod(target, camDist);
      } else if (terrainVisibilityDirtyRef.current) {
        updateTerrainVisibility(target, camDist);
        terrainVisibilityDirtyRef.current = false;
      }

      const focus = resolveVoxelLodFocus(camera, controls);
      const focusLod = getLodForDistanceWithHysteresis(
        focus.zoomDist,
        activeFocusLodRef.current,
        voxelLodThresholdsRef.current,
      );
      activeFocusLodRef.current = focusLod;
      updateVoxelLod(focus.point, focus.zoomDist, focusLod);
    }

    if (debugLabelsDirtyRef.current) {
      debugLabelsDirtyRef.current = false;
      refreshDebugLabels();
    }
    if (biomeLabelsDirtyRef.current) {
      biomeLabelsDirtyRef.current = false;
      void refreshBiomeLabels(target, camDist);
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
        version,
        quadrantMeshes,
        chunkCoverage,
        chunkTopHeights,
        voxelSize,
        minZ,
        maxZ,
        error,
      } = e.data as WorkerOut;

      const resolvedLod = lod ?? 1;
      const key = voxelTileKey(resolvedLod, regionX, regionY);
      const resolvedVersion = version ?? 0;
      if (error || !quadrantMeshes) {
        if (resolvedVersion < getVoxelRefreshVersion(key)) {
          loadingVoxelsRef.current.delete(key);
          return;
        }
        if (!activeVoxelRequestKeysRef.current.has(key)) {
          loadingVoxelsRef.current.delete(key);
          return;
        }
        loadingVoxelsRef.current.delete(key);
        failedVoxelsRef.current.set(key, (failedVoxelsRef.current.get(key) ?? 0) + 1);
        return;
      }

      if (!activeVoxelRequestKeysRef.current.has(key) && !(loadedVoxelsRef.current.has(key) && isVoxelTileStale(key))) {
        loadingVoxelsRef.current.delete(key);
        return;
      }

      if (resolvedVersion < getVoxelRefreshVersion(key)) {
        loadingVoxelsRef.current.delete(key);
        return;
      }

      pendingVoxelMeshQueueRef.current = pendingVoxelMeshQueueRef.current.filter(
        (item) => item.key !== key || item.version >= resolvedVersion
      );

      const topHeights = chunkTopHeights && chunkTopHeights.length === 16
        ? chunkTopHeights
        : new Float32Array(16).fill(Number.NEGATIVE_INFINITY);

      pendingVoxelMeshQueueRef.current.push({
        key,
        lod: resolvedLod,
        regionX,
        regionY,
        quadrantMeshes,
        chunkCoverage: chunkCoverage ?? 0,
        chunkTopHeights: topHeights,
        voxelSize: voxelSize ?? resolvedLod,
        minZ: Number.isFinite(minZ) ? minZ : 0,
        maxZ: Number.isFinite(maxZ) ? maxZ : 0,
        version: resolvedVersion,
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
    const LOD_CHECK_INTERVAL = 8;

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

      let builtVoxelTile = false;
      if (pendingVoxelMeshQueueRef.current.length > 0) {
        const voxelMeshBuildStart = performance.now();
        let processedVoxelMeshes = 0;
        while (
          pendingVoxelMeshQueueRef.current.length > 0
          && processedVoxelMeshes < MAX_VOXEL_MESHES_PER_FRAME
          && performance.now() - voxelMeshBuildStart < VOXEL_MESH_BUILD_BUDGET_MS
        ) {
          const item = pendingVoxelMeshQueueRef.current.shift()!;
          processedVoxelMeshes++;
          if (item.version < getVoxelRefreshVersion(item.key)) {
            loadingVoxelsRef.current.delete(item.key);
            continue;
          }
          if (!activeVoxelRequestKeysRef.current.has(item.key) && !(loadedVoxelsRef.current.has(item.key) && isVoxelTileStale(item.key))) {
            loadingVoxelsRef.current.delete(item.key);
            continue;
          }

          const existingTile = loadedVoxelsRef.current.get(item.key);
          const canReplaceExisting = existingTile ? isVoxelTileStale(item.key) : false;
          loadingVoxelsRef.current.delete(item.key);
          if ((!existingTile || canReplaceExisting) && voxelGroupRef.current && modeRef.current === "voxel") {
            const built = buildVoxelQuadrantSubMeshes(item);
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
              borderLines.visible = false;

              for (const sm of built.subMeshes) {
                sm.mesh.visible = false;
                voxelGroupRef.current.add(sm.mesh);
              }
              chunkBorderGroupRef.current?.add(borderLines);
              const nextTile: LoadedVoxelTile = {
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
              };
              loadedVoxelsRef.current.set(item.key, nextTile);
              if (existingTile && canReplaceExisting) {
                disposeVoxelTileResources(existingTile);
              }
              markVoxelTileFresh(item.key, item.version);
              failedVoxelsRef.current.delete(item.key);
              debugLabelsDirtyRef.current = true;
              builtVoxelTile = true;
            }
          }
        }
      }

      if (builtVoxelTile) {
        checkAndUpdateLOD(camera, controls);
      }

      if (
        terrainVisibilityDirtyRef.current
        && shouldRenderTerrainForMode(modeRef.current, showTerrainRef.current, showVoxelTerrainRef.current)
      ) {
        const camDist = camera.position.distanceTo(controls.target);
        updateTerrainVisibility(controls.target, camDist);
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
            const camDist = camera.position.distanceTo(controls.target);
            void refreshBiomeLabels(controls.target, camDist);
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
      const memoryByLod: Partial<Record<1 | 2 | 4 | 8 | 16 | 32, number>> = {};
      let terrainMemoryBytes = 0;
      let voxelMemoryBytes = 0;
      let cachedVoxelMemoryBytes = 0;
      let queuedMemoryBytes = 0;

      for (const tile of loadedTerrainRef.current.values()) {
        const lod = tile.lod as 1 | 2 | 4 | 8 | 16 | 32;
        const tileBytes = estimateGeometryBytes(tile.mesh.geometry) + estimateGeometryBytes(tile.borderLines.geometry);
        if (modeRef.current === "terrain") {
          loadedByLod[lod] = (loadedByLod[lod] ?? 0) + 1;
        }
        terrainMemoryBytes += tileBytes;
        addMemoryToLod(memoryByLod, lod, tileBytes);
      }

      for (const tile of loadedVoxelsRef.current.values()) {
        const lod = tile.lod as 1 | 2 | 4 | 8 | 16 | 32;
        const tileBytes = estimateLoadedVoxelTileBytes(tile);
        if (modeRef.current === "voxel") {
          loadedByLod[lod] = (loadedByLod[lod] ?? 0) + 1;
        }
        voxelMemoryBytes += tileBytes;
        addMemoryToLod(memoryByLod, lod, tileBytes);
      }

      for (const cached of warmCachedVoxelsRef.current.values()) {
        const lod = cached.tile.lod as 1 | 2 | 4 | 8 | 16 | 32;
        cachedVoxelMemoryBytes += cached.bytes;
        addMemoryToLod(memoryByLod, lod, cached.bytes);
      }

      for (const item of pendingVoxelMeshQueueRef.current) {
        for (const quadrant of item.quadrantMeshes) {
          queuedMemoryBytes += quadrant.positions.byteLength;
          queuedMemoryBytes += quadrant.normals.byteLength;
          queuedMemoryBytes += quadrant.colors.byteLength;
          queuedMemoryBytes += quadrant.indices.byteLength;
        }
        queuedMemoryBytes += item.chunkTopHeights.byteLength;
      }

      const memoryBytes = terrainMemoryBytes + voxelMemoryBytes + cachedVoxelMemoryBytes + queuedMemoryBytes;
      const perfWithMemory = performance as Performance & { memory?: PerformanceMemoryInfo };
      const jsHeapBytes = perfWithMemory.memory?.usedJSHeapSize ?? null;

      const statsPayload: ChunkStatsPayload = {
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
        memoryBytes,
        memoryBreakdown: {
          terrain: terrainMemoryBytes,
          voxels: voxelMemoryBytes,
          cached: cachedVoxelMemoryBytes,
          queued: queuedMemoryBytes,
        },
        memoryByLod,
        jsHeapBytes,
        warmCacheCount: warmCachedVoxelsRef.current.size,
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
    rebuildVoxelIndexCache(worldData.chunkIndex);

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
        memoryBytes: 0,
        memoryBreakdown: {
          terrain: 0,
          voxels: 0,
          cached: 0,
          queued: 0,
        },
        memoryByLod: {},
        jsHeapBytes: null,
        warmCacheCount: 0,
      });
    };
  }, []);

  useEffect(() => {
    surfaceIndexRef.current = worldData.surfaceIndex;
    if (shouldRenderTerrainForMode(mode, showTerrain, showVoxelTerrain) && sceneRef.current) {
      checkAndUpdateLOD(sceneRef.current.camera, sceneRef.current.controls);
    }
  }, [worldData.surfaceIndex, mode, showTerrain, showVoxelTerrain]);

  useEffect(() => {
    chunkIndexRef.current = worldData.chunkIndex;
    rebuildVoxelIndexCache(worldData.chunkIndex);
    if (mode === "voxel") {
      missingVoxelsRef.current.clear();
      failedVoxelsRef.current.clear();
      if (sceneRef.current) {
        checkAndUpdateLOD(sceneRef.current.camera, sceneRef.current.controls);
      }
    }
  }, [worldData.chunkIndex, mode]);

  useEffect(() => {
    if (mode !== "voxel" || !sceneRef.current) return;
    checkAndUpdateLOD(sceneRef.current.camera, sceneRef.current.controls);
  }, [mode, voxelLod1MaxDist]);

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
    const renderTerrain = shouldRenderTerrainForMode(mode, showTerrain, showVoxelTerrain);
    if (terrainGroupRef.current) {
      terrainGroupRef.current.visible = renderTerrain;
      terrainGroupRef.current.position.z = mode === "voxel" ? TERRAIN_UNDERLAY_OFFSET_Z : 0;
    }
    if (voxelGroupRef.current) {
      voxelGroupRef.current.visible = mode === "voxel";
    }
    terrainVisibilityDirtyRef.current = true;
    debugLabelsDirtyRef.current = true;
    biomeLabelsDirtyRef.current = true;
  }, [mode, showTerrain, showVoxelTerrain]);

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
      const camDist = sceneRef.current.camera.position.distanceTo(sceneRef.current.controls.target);
      void refreshBiomeLabels(sceneRef.current.controls.target, camDist);
    }
  }, [showBiomeLabels, mode]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (mode === "terrain") {
      clearVoxelTiles(true);
      debugLabelsDirtyRef.current = true;
      biomeLabelsDirtyRef.current = true;
    } else if (!showVoxelTerrain) {
      clearTerrainTiles();
      debugLabelsDirtyRef.current = true;
      biomeLabelsDirtyRef.current = true;
    }

    checkAndUpdateLOD(scene.camera, scene.controls);
  }, [mode, showVoxelTerrain]);

  useEffect(() => {
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
