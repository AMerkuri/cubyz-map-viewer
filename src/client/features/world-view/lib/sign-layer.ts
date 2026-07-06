import type { QueryClient } from "@tanstack/react-query";
import * as THREE from "three";
import {
  fetchSignRecords,
  SIGN_TEXT_LOD,
  type SignRecord,
  signRecordsQueryKey,
} from "./sign-records.js";
import { createSignTextTexture } from "./sign-texture.js";
import { parseVoxelKey } from "./utils.js";

// Small world-space nudge along the sign normal to avoid z-fighting with the
// board geometry, scaled per LOD so it stays consistent in cell units.
const NORMAL_EPSILON = 0.02;

interface SignRegionEntry {
  key: string;
  meshes: THREE.Mesh[];
  geometries: THREE.BufferGeometry[];
  materials: THREE.MeshBasicMaterial[];
  textures: THREE.CanvasTexture[];
  loading: boolean;
  controller: AbortController | null;
}

/**
 * Imperative manager for on-face sign text quads.
 *
 * Owns a scene group and, per region, a set of textured quads built from the
 * server-provided text-plane corners. Rendering is LOD-gated to LOD 1: at
 * coarser LODs all quads are removed; when the view returns to LOD 1 they are
 * rebuilt from the (cached) sign records. All GPU resources are disposed on
 * region unload, sign-record change, or LOD change away from the threshold.
 */
export class SignLayerManager {
  private readonly group = new THREE.Group();
  private readonly regions = new Map<string, SignRegionEntry>();
  private readonly queryClient: QueryClient;
  private readonly getLod: () => number;
  private readonly requestRender: () => void;
  private attached = false;

  constructor(args: {
    queryClient: QueryClient;
    getActiveLod: () => number;
    requestRender: () => void;
  }) {
    this.queryClient = args.queryClient;
    this.getLod = args.getActiveLod;
    this.requestRender = args.requestRender;
    this.group.name = "sign-text";
  }

  attachTo(scene: THREE.Scene): void {
    scene.add(this.group);
    this.attached = true;
  }

  isAttached(): boolean {
    return this.attached;
  }

  /**
   * Reconcile rendered sign regions with the set of loaded LOD-1 voxel region
   * keys for the current active LOD. Builds quads for newly-visible regions,
   * disposes regions no longer present, and clears everything when the active
   * LOD is not the sign-text LOD.
   */
  sync(loadedVoxelKeys: Iterable<string>): void {
    if (this.getLod() !== SIGN_TEXT_LOD) {
      this.clear();
      return;
    }

    const desired = new Set<string>();
    for (const key of loadedVoxelKeys) {
      const parsed = parseVoxelKey(key);
      if (!parsed || parsed.lod !== SIGN_TEXT_LOD) continue;
      desired.add(key);
      if (!this.regions.has(key)) {
        this.beginRegion(key, parsed.regionX, parsed.regionY);
      }
    }

    for (const key of [...this.regions.keys()]) {
      if (!desired.has(key)) {
        this.disposeRegion(key);
      }
    }
  }

  /**
   * Drop a region's rendered quads and cached fetch so it rebuilds with fresh
   * records. Invoked on world-update events affecting the region.
   */
  invalidateRegion(regionX: number, regionY: number): void {
    const key = `${SIGN_TEXT_LOD}/${regionX}/${regionY}`;
    this.queryClient.removeQueries({
      queryKey: signRecordsQueryKey(SIGN_TEXT_LOD, regionX, regionY),
    });
    if (this.regions.has(key)) {
      this.disposeRegion(key);
    }
  }

  clear(): void {
    for (const key of [...this.regions.keys()]) {
      this.disposeRegion(key);
    }
  }

  dispose(scene: THREE.Scene | null): void {
    this.clear();
    scene?.remove(this.group);
    this.attached = false;
  }

  private beginRegion(key: string, regionX: number, regionY: number): void {
    const controller = new AbortController();
    const entry: SignRegionEntry = {
      key,
      meshes: [],
      geometries: [],
      materials: [],
      textures: [],
      loading: true,
      controller,
    };
    this.regions.set(key, entry);

    void fetchSignRecords({
      queryClient: this.queryClient,
      lod: SIGN_TEXT_LOD,
      regionX,
      regionY,
      signal: controller.signal,
    })
      .then((records) => {
        // The region may have been disposed or the LOD changed while fetching.
        const current = this.regions.get(key);
        if (current !== entry || this.getLod() !== SIGN_TEXT_LOD) return;
        entry.loading = false;
        this.buildRegionMeshes(entry, records);
        if (entry.meshes.length > 0) this.requestRender();
      })
      .catch(() => {
        if (this.regions.get(key) === entry) {
          this.regions.delete(key);
        }
      });
  }

  private buildRegionMeshes(
    entry: SignRegionEntry,
    records: SignRecord[],
  ): void {
    const lod = this.getLod();
    for (const record of records) {
      if (record.text.length === 0) continue;
      const built = buildSignQuad(record, lod);
      if (!built) continue;
      entry.geometries.push(built.geometry);
      entry.materials.push(built.material);
      entry.textures.push(built.texture);
      entry.meshes.push(built.mesh);
      this.group.add(built.mesh);
    }
  }

  private disposeRegion(key: string): void {
    const entry = this.regions.get(key);
    if (!entry) return;
    this.regions.delete(key);
    entry.controller?.abort();
    for (const mesh of entry.meshes) {
      this.group.remove(mesh);
    }
    for (const geometry of entry.geometries) geometry.dispose();
    for (const material of entry.materials) material.dispose();
    for (const texture of entry.textures) texture.dispose();
    entry.meshes.length = 0;
    entry.geometries.length = 0;
    entry.materials.length = 0;
    entry.textures.length = 0;
  }
}

interface BuiltSignQuad {
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  material: THREE.MeshBasicMaterial;
  texture: THREE.CanvasTexture;
}

function buildSignQuad(record: SignRecord, lod: number): BuiltSignQuad | null {
  const [c0, c1, c2, c3] = record.corners;
  if (!c0 || !c1 || !c2 || !c3) return null;

  // Corner order (from the server): (yMin,zMin) → (yMax,zMin) → (yMax,zMax) →
  // (yMin,zMax) in the board's local frame, i.e. bottom-left, bottom-right,
  // top-right, top-left of the text plane.
  const normal = computeNormal(c0, c1, c2);
  const offset = NORMAL_EPSILON * lod;
  const nx = normal.x * offset;
  const ny = normal.y * offset;
  const nz = normal.z * offset;

  const positions = new Float32Array([
    c0.x + nx,
    c0.y + ny,
    c0.z + nz,
    c1.x + nx,
    c1.y + ny,
    c1.z + nz,
    c2.x + nx,
    c2.y + ny,
    c2.z + nz,
    c3.x + nx,
    c3.y + ny,
    c3.z + nz,
  ]);

  // UVs map the canvas (text upright) onto the plane: bottom-left (0,0),
  // bottom-right (1,0), top-right (1,1), top-left (0,1).
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  const indices = [0, 1, 2, 0, 2, 3];

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const texture = createSignTextTexture(record.text);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    // Depth-tested so the sign hides behind intervening terrain/voxels.
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 5;
  return { mesh, geometry, material, texture };
}

function computeNormal(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
  c: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const acx = c.x - a.x;
  const acy = c.y - a.y;
  const acz = c.z - a.z;
  const x = aby * acz - abz * acy;
  const y = abz * acx - abx * acz;
  const z = abx * acy - aby * acx;
  const length = Math.hypot(x, y, z);
  if (length === 0) return { x: 0, y: 0, z: 1 };
  return { x: x / length, y: y / length, z: z / length };
}
