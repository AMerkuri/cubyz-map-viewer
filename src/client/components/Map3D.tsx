import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { useWorldData } from "../hooks/useWorldData.js";
import type { PlayerData } from "../hooks/usePlayers.js";
import type { WatchEvent, WatchEventType } from "../hooks/useWebSocket.js";
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

interface Map3DProps {
  worldData: ReturnType<typeof useWorldData>;
  players: PlayerData[];
  subscribe: (type: WatchEventType, handler: (event: WatchEvent) => void) => () => void;
}

/** LODs ordered from fine to coarse */
const LOD_LEVELS = [1, 2, 4, 8, 16, 32];

/** Distance thresholds for LOD selection (in world units from camera target) */
const LOD_DISTANCE_THRESHOLDS = [
  { maxDist: 600, lod: 1 },
  { maxDist: 1200, lod: 2 },
  { maxDist: 2400, lod: 4 },
  { maxDist: 4800, lod: 8 },
  { maxDist: 9600, lod: 16 },
  { maxDist: Infinity, lod: 32 },
];

interface LoadedTile {
  lod: number;
  tileX: number;
  tileY: number;
  mesh: THREE.Mesh;
  worldX: number;
  worldY: number;
}

async function fetchTerrain(
  lod: number,
  tileX: number,
  tileY: number
): Promise<TerrainMeshData | null> {
  const url = `/api/terrain/${lod}/${tileX}/${tileY}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.error(`Failed to load terrain ${url}:`, e);
    return null;
  }
}

/**
 * Build a Three.js mesh from terrain data.
 *
 * Coordinate mapping:
 *   - Three.js X = world X (increases rightward)
 *   - Three.js Y = -world Y (PlaneGeometry row 0 is +Y, so we negate
 *     so that increasing world Y moves toward -Y, keeping row order correct)
 *   - Three.js Z = height (up)
 */
function buildTerrainMesh(data: TerrainMeshData): THREE.Mesh {
  // Size in world units that this tile covers
  const worldTileSize = 256 * data.voxelSize;

  const geometry = new THREE.PlaneGeometry(
    worldTileSize,
    worldTileSize,
    data.width - 1,
    data.height - 1
  );

  const positions = geometry.attributes.position;
  const colorAttr = new Float32Array(positions.count * 3);
  const heightScale = 1.0;

  for (let i = 0; i < positions.count; i++) {
    const col = i % data.width;
    const row = Math.floor(i / data.width);
    // Data is column-major: data[x * height + y]
    const dataIdx = col * data.height + row;

    positions.setZ(i, (data.heights[dataIdx] ?? 0) * heightScale);

    colorAttr[i * 3] = (data.colors[dataIdx * 3] ?? 128) / 255;
    colorAttr[i * 3 + 1] = (data.colors[dataIdx * 3 + 1] ?? 128) / 255;
    colorAttr[i * 3 + 2] = (data.colors[dataIdx * 3 + 2] ?? 128) / 255;
  }

  geometry.setAttribute("color", new THREE.BufferAttribute(colorAttr, 3));
  geometry.computeVertexNormals();

  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);

  // Position: center of the tile in world space
  // PlaneGeometry is centered at origin, so offset by tile center
  const centerX = data.worldX + worldTileSize / 2;
  const centerY = -(data.worldY + worldTileSize / 2);
  mesh.position.set(centerX, centerY, 0);

  return mesh;
}

function createTextSprite(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.font = "bold 28px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.fillText(text, 130, 34);
  // Text
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 32);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(60, 15, 1);
  return sprite;
}

/** Strip Cubyz color formatting codes from player names */
function cleanPlayerName(name: string): string {
  return name.replace(/[*]{1,3}|#[0-9A-Fa-f]{6}/g, "").trim() || "Player";
}

/** Convert world coordinates to 3D scene coordinates */
function worldToScene(
  worldX: number,
  worldY: number,
  worldZ: number
): [number, number, number] {
  return [worldX, -worldY, worldZ];
}

/** Get the ideal LOD for a tile based on its distance from the camera target */
function getLodForDistance(dist: number): number {
  for (const threshold of LOD_DISTANCE_THRESHOLDS) {
    if (dist <= threshold.maxDist) {
      return threshold.lod;
    }
  }
  return 32;
}

export function Map3D({ worldData, players, subscribe }: Map3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    animFrameId: number;
  } | null>(null);
  const initializedRef = useRef(false);
  const loadedTilesRef = useRef<Map<string, LoadedTile>>(new Map());
  const loadingTilesRef = useRef<Set<string>>(new Set());
  const terrainGroupRef = useRef<THREE.Group | null>(null);
  const markerGroupRef = useRef<THREE.Group | null>(null);
  const spawnGroupRef = useRef<THREE.Group | null>(null);
  const surfaceIndexRef = useRef<SurfaceIndexEntry[]>([]);
  const playersRef = useRef(players);
  const worldDataRef = useRef(worldData);
  playersRef.current = players;
  worldDataRef.current = worldData;

  // Set up Three.js scene once
  useEffect(() => {
    if (!containerRef.current || sceneRef.current) return;
    const container = containerRef.current;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);

    const camera = new THREE.PerspectiveCamera(
      60,
      container.clientWidth / container.clientHeight,
      1,
      50000
    );
    camera.up.set(0, 0, 1);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.maxPolarAngle = Math.PI * 0.85;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x404060, 1.5);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
    directionalLight.position.set(100, -100, 200);
    scene.add(directionalLight);
    const fillLight = new THREE.DirectionalLight(0x8888aa, 0.4);
    fillLight.position.set(-50, 50, 100);
    scene.add(fillLight);

    // Groups for terrain and markers
    const terrainGroup = new THREE.Group();
    scene.add(terrainGroup);
    terrainGroupRef.current = terrainGroup;

    const markerGroup = new THREE.Group();
    scene.add(markerGroup);
    markerGroupRef.current = markerGroup;

    const spawnGroup = new THREE.Group();
    scene.add(spawnGroup);
    spawnGroupRef.current = spawnGroup;

    let animFrameId = 0;
    let lodCheckCounter = 0;
    const LOD_CHECK_INTERVAL = 60; // Check LOD every ~1 second at 60fps

    function animate() {
      animFrameId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);

      // Periodically check if LOD needs updating
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
    }
    window.addEventListener("resize", onResize);

    sceneRef.current = { renderer, scene, camera, controls, animFrameId };

    return () => {
      cancelAnimationFrame(animFrameId);
      window.removeEventListener("resize", onResize);
      controls.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      // Clean up loaded tile meshes
      for (const tile of loadedTilesRef.current.values()) {
        tile.mesh.geometry.dispose();
        (tile.mesh.material as THREE.Material).dispose();
      }
      loadedTilesRef.current.clear();
      loadingTilesRef.current.clear();
      sceneRef.current = null;
      terrainGroupRef.current = null;
      markerGroupRef.current = null;
      spawnGroupRef.current = null;
      initializedRef.current = false;
    };
  }, []);

  // Initial terrain load and camera positioning
  useEffect(() => {
    if (initializedRef.current) return;
    if (!sceneRef.current) return;
    if (worldData.loading) return;
    if (worldData.surfaceIndex.length === 0) return;

    initializedRef.current = true;
    surfaceIndexRef.current = worldData.surfaceIndex;

    const { camera, controls } = sceneRef.current;

    // Position camera at spawn
    const spawnData = worldData.worldData;
    if (spawnData) {
      const [sx, sy, sz] = worldToScene(
        spawnData.spawn[0],
        spawnData.spawn[1],
        spawnData.spawn[2]
      );
      camera.position.set(sx, sy - 400, sz + 300);
      controls.target.set(sx, sy, sz);
      controls.update();
    }

    // Load initial tiles around spawn at LOD 1
    loadTilesAroundTarget(controls.target, worldData.surfaceIndex);

    // Add spawn marker
    addSpawnMarker();
  }, [worldData.loading, worldData.surfaceIndex]);

  // Update surface index ref when it changes
  useEffect(() => {
    surfaceIndexRef.current = worldData.surfaceIndex;
  }, [worldData.surfaceIndex]);

  // Update player markers when players change
  useEffect(() => {
    updatePlayerMarkers();
  }, [players]);

  // Subscribe to tile-updated WebSocket events
  useEffect(() => {
    const unsub = subscribe("tile-updated", (event) => {
      if (!event.data) return;
      const { lod, tileX, tileY } = event.data as { lod: number; tileX: number; tileY: number };
      const key = `${lod}/${tileX}/${tileY}`;
      const existing = loadedTilesRef.current.get(key);
      if (existing) {
        // Remove old mesh and reload
        terrainGroupRef.current?.remove(existing.mesh);
        existing.mesh.geometry.dispose();
        (existing.mesh.material as THREE.Material).dispose();
        loadedTilesRef.current.delete(key);
        loadTile(lod, tileX, tileY);
      }
    });
    return unsub;
  }, [subscribe]);

  function checkAndUpdateLOD(
    camera: THREE.PerspectiveCamera,
    controls: OrbitControls
  ) {
    const index = surfaceIndexRef.current;
    if (index.length === 0) return;

    const target = controls.target;
    const camDist = camera.position.distanceTo(target);

    // Determine which tiles should be loaded based on camera frustum
    // For each available LOD, check which tiles are visible
    for (const entry of index) {
      const tileWorldSize = 256 * entry.lod;
      const tileCenterX = entry.worldX + tileWorldSize / 2;
      const tileCenterY = -(entry.worldY + tileWorldSize / 2);

      // Distance from camera target to tile center
      const dx = tileCenterX - target.x;
      const dy = tileCenterY - target.y;
      const tileDist = Math.sqrt(dx * dx + dy * dy);

      // Desired LOD based on distance
      const desiredLod = getLodForDistance(tileDist);

      // Only load if this entry matches the desired LOD
      if (entry.lod !== desiredLod) continue;

      const key = `${entry.lod}/${entry.tileX}/${entry.tileY}`;
      if (loadedTilesRef.current.has(key) || loadingTilesRef.current.has(key)) continue;

      // Skip tiles that are very far from the camera
      if (tileDist > camDist * 3) continue;

      loadTile(entry.lod, entry.tileX, entry.tileY);
    }

    // Unload tiles that are too far or at wrong LOD
    for (const [key, tile] of loadedTilesRef.current) {
      const tileWorldSize = 256 * tile.lod;
      const tileCenterX = tile.worldX + tileWorldSize / 2;
      const tileCenterY = -(tile.worldY + tileWorldSize / 2);

      const dx = tileCenterX - target.x;
      const dy = tileCenterY - target.y;
      const tileDist = Math.sqrt(dx * dx + dy * dy);

      const desiredLod = getLodForDistance(tileDist);

      // Remove if:
      // 1. Tile is at wrong LOD for its distance
      // 2. Tile is extremely far away
      const shouldRemove =
        tile.lod !== desiredLod || tileDist > camDist * 4;

      if (shouldRemove) {
        terrainGroupRef.current?.remove(tile.mesh);
        tile.mesh.geometry.dispose();
        (tile.mesh.material as THREE.Material).dispose();
        loadedTilesRef.current.delete(key);
      }
    }
  }

  function loadTilesAroundTarget(
    target: THREE.Vector3,
    index: SurfaceIndexEntry[]
  ) {
    // Load LOD 1 tiles near target, lower LODs for farther tiles
    for (const entry of index) {
      const tileWorldSize = 256 * entry.lod;
      const tileCenterX = entry.worldX + tileWorldSize / 2;
      const tileCenterY = -(entry.worldY + tileWorldSize / 2);

      const dx = tileCenterX - target.x;
      const dy = tileCenterY - target.y;
      const tileDist = Math.sqrt(dx * dx + dy * dy);

      const desiredLod = getLodForDistance(tileDist);
      if (entry.lod !== desiredLod) continue;

      const key = `${entry.lod}/${entry.tileX}/${entry.tileY}`;
      if (loadedTilesRef.current.has(key) || loadingTilesRef.current.has(key)) continue;

      loadTile(entry.lod, entry.tileX, entry.tileY);
    }
  }

  async function loadTile(lod: number, tileX: number, tileY: number) {
    const key = `${lod}/${tileX}/${tileY}`;
    if (loadingTilesRef.current.has(key)) return;
    loadingTilesRef.current.add(key);

    try {
      const data = await fetchTerrain(lod, tileX, tileY);
      if (!data || !terrainGroupRef.current) return;

      // Check if this tile was already loaded (e.g. by another concurrent load)
      if (loadedTilesRef.current.has(key)) return;

      const mesh = buildTerrainMesh(data);
      terrainGroupRef.current.add(mesh);

      loadedTilesRef.current.set(key, {
        lod,
        tileX,
        tileY,
        mesh,
        worldX: data.worldX,
        worldY: data.worldY,
      });
    } catch (e) {
      console.error(`Failed to load tile ${key}:`, e);
    } finally {
      loadingTilesRef.current.delete(key);
    }
  }

  function addSpawnMarker() {
    const spawn = worldDataRef.current.worldData?.spawn;
    if (!spawn || !spawnGroupRef.current) return;

    const [sx, sy, sz] = worldToScene(spawn[0], spawn[1], spawn[2]);

    // Red sphere
    const geom = new THREE.SphereGeometry(5, 16, 16);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff4444 });
    const sphere = new THREE.Mesh(geom, mat);
    sphere.position.set(sx, sy, sz + 8);
    spawnGroupRef.current.add(sphere);

    // Label
    const label = createTextSprite("Spawn", "#ff4444");
    label.position.set(sx, sy, sz + 25);
    spawnGroupRef.current.add(label);
  }

  function updatePlayerMarkers() {
    const group = markerGroupRef.current;
    if (!group) return;

    // Clear existing player markers
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
      if (child instanceof THREE.Sprite) {
        (child.material as THREE.SpriteMaterial).map?.dispose();
        child.material.dispose();
      }
    }

    for (const player of playersRef.current) {
      const [px, py, pz] = worldToScene(
        player.position[0],
        player.position[1],
        player.position[2]
      );

      // Player sphere
      const geom = new THREE.SphereGeometry(4, 12, 12);
      const mat = new THREE.MeshBasicMaterial({ color: 0x44aaff });
      const sphere = new THREE.Mesh(geom, mat);
      sphere.position.set(px, py, pz + 6);
      group.add(sphere);

      // Player name label
      const name = cleanPlayerName(player.name);
      const label = createTextSprite(name, "#44aaff");
      label.position.set(px, py, pz + 20);
      group.add(label);
    }
  }

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
