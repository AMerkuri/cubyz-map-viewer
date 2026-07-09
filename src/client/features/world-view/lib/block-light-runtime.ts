import * as THREE from "three";
import {
  MESH_BLOCK_LIGHT_DAY_FLOOR,
  setMeshBlockLightStrength,
} from "./block-light-mesh.js";
import type { LoadedVoxelTile, VoxelEmitterRecord } from "./types.js";

// Point lights and glow sprites are secondary accents over the worker-baked
// mesh-local emitted light, so their budgets bound only the optional extras;
// surface illumination for loaded voxel geometry never depends on them.
const BALANCED_LIGHT_BUDGET = 0;
const HIGH_LIGHT_BUDGET = 16;
const BALANCED_GLOW_BUDGET = 96;
const HIGH_GLOW_BUDGET = 220;

interface RegionEffects {
  emitters: VoxelEmitterRecord[];
  group: THREE.Group;
  sprites: THREE.Sprite[];
}

export interface BlockLightRuntimeStats {
  decodedEmitters: number;
  activeEmitters: number;
  budget: number;
  glowBudget: number;
  pointLightBudget: number;
  degraded: boolean;
}

export class BlockLightRuntimeManager {
  private readonly regions = new Map<string, RegionEffects>();
  private readonly lights: THREE.PointLight[] = [];
  private readonly texture = createGlowTexture();
  private stats: BlockLightRuntimeStats = {
    decodedEmitters: 0,
    activeEmitters: 0,
    budget: 0,
    glowBudget: 0,
    pointLightBudget: 0,
    degraded: false,
  };

  constructor(private readonly scene: THREE.Scene) {}

  syncRegions(loadedVoxels: Iterable<LoadedVoxelTile>): void {
    const seen = new Set<string>();
    for (const tile of loadedVoxels) {
      seen.add(tile.key);
      if (this.regions.has(tile.key)) continue;
      this.addRegion(tile);
    }

    for (const key of [...this.regions.keys()]) {
      if (!seen.has(key)) this.removeRegion(key);
    }
  }

  update(args: {
    enabled: boolean;
    quality: number;
    timeOfDay: number;
    cameraPosition: THREE.Vector3;
  }): BlockLightRuntimeStats {
    const allEmitters = [...this.regions.values()].flatMap(
      (region) => region.emitters,
    );
    const nightStrength = getNightStrength(args.timeOfDay);
    // Primary presentation: worker-baked mesh-local emitted light, driven by
    // one shared shader uniform. Quality 0 (or disabled atmosphere) keeps the
    // strength at 0 so voxel rendering falls back to the unlit base colors.
    setMeshBlockLightStrength(
      args.enabled && args.quality >= 1
        ? MESH_BLOCK_LIGHT_DAY_FLOOR +
            (1 - MESH_BLOCK_LIGHT_DAY_FLOOR) * nightStrength
        : 0,
    );
    const lightBudget = args.enabled
      ? args.quality >= 2
        ? HIGH_LIGHT_BUDGET
        : args.quality >= 1
          ? BALANCED_LIGHT_BUDGET
          : 0
      : 0;
    const glowBudget = args.enabled
      ? args.quality >= 2
        ? HIGH_GLOW_BUDGET
        : args.quality >= 1
          ? BALANCED_GLOW_BUDGET
          : 0
      : 0;
    const visibleBudget = Math.max(lightBudget, glowBudget);
    const activeEmitters =
      args.enabled && nightStrength > 0
        ? allEmitters
            .map((emitter) => ({
              emitter,
              distance: args.cameraPosition.distanceToSquared(
                TEMP_POSITION.set(emitter.x, emitter.y, emitter.z),
              ),
            }))
            .sort((a, b) => a.distance - b.distance)
            .slice(0, visibleBudget)
            .map((entry) => entry.emitter)
        : [];
    const activeKeys = new Set(activeEmitters.map(emitterKey));

    for (const region of this.regions.values()) {
      for (let i = 0; i < region.emitters.length; i++) {
        const emitter = region.emitters[i];
        const sprite = region.sprites[i];
        if (!emitter || !sprite) continue;
        const active = activeKeys.has(emitterKey(emitter));
        sprite.visible = active;
        if (active) {
          // Accent-scale glow: the mesh carries the illumination, so sprites
          // only add a soft source highlight.
          const scale = 1.15 + 0.85 * nightStrength;
          sprite.scale.setScalar(scale);
          const material = sprite.material as THREE.SpriteMaterial;
          material.opacity = 0.08 + 0.1 * nightStrength;
        }
      }
    }

    this.ensureLightPool(lightBudget);
    for (let i = 0; i < this.lights.length; i++) {
      const light = this.lights[i];
      const emitter = activeEmitters[i];
      if (!emitter || i >= lightBudget || nightStrength <= 0) {
        light.visible = false;
        continue;
      }
      light.visible = true;
      light.position.set(emitter.x, emitter.y, emitter.z);
      light.color.setRGB(emitter.r / 255, emitter.g / 255, emitter.b / 255);
      // Accent intensity: local surface illumination is baked into the mesh,
      // so the pooled lights only add nearby dynamic sparkle.
      light.intensity = 0.16 * nightStrength;
      light.distance = 14;
    }

    this.stats = {
      decodedEmitters: allEmitters.length,
      activeEmitters: activeEmitters.length,
      budget: visibleBudget,
      glowBudget,
      pointLightBudget: lightBudget,
      degraded: allEmitters.length > visibleBudget,
    };
    return this.stats;
  }

  getStats(): BlockLightRuntimeStats {
    return this.stats;
  }

  dispose(): void {
    setMeshBlockLightStrength(0);
    for (const key of [...this.regions.keys()]) this.removeRegion(key);
    for (const light of this.lights) this.scene.remove(light);
    this.lights.length = 0;
    this.texture.dispose();
  }

  private addRegion(tile: LoadedVoxelTile): void {
    const group = new THREE.Group();
    group.name = `block-light:${tile.key}`;
    const sprites = tile.emitterRecords.map((emitter) => {
      const material = new THREE.SpriteMaterial({
        map: this.texture,
        color: new THREE.Color(
          emitter.r / 255,
          emitter.g / 255,
          emitter.b / 255,
        ),
        transparent: true,
        depthWrite: false,
        opacity: 0,
        blending: THREE.NormalBlending,
        depthTest: true,
      });
      const sprite = new THREE.Sprite(material);
      sprite.position.set(emitter.x, emitter.y, emitter.z);
      sprite.visible = false;
      group.add(sprite);
      return sprite;
    });
    this.scene.add(group);
    this.regions.set(tile.key, {
      emitters: tile.emitterRecords,
      group,
      sprites,
    });
  }

  private removeRegion(key: string): void {
    const region = this.regions.get(key);
    if (!region) return;
    this.scene.remove(region.group);
    for (const sprite of region.sprites) {
      (sprite.material as THREE.SpriteMaterial).dispose();
    }
    this.regions.delete(key);
  }

  private ensureLightPool(count: number): void {
    while (this.lights.length < count) {
      const light = new THREE.PointLight(0xffffff, 0, 24);
      light.visible = false;
      this.scene.add(light);
      this.lights.push(light);
    }
    for (let i = count; i < this.lights.length; i++) {
      this.lights[i].visible = false;
    }
  }
}

const TEMP_POSITION = new THREE.Vector3();

function emitterKey(emitter: VoxelEmitterRecord): string {
  return `${Math.round(emitter.x)}/${Math.round(emitter.y)}/${Math.round(
    emitter.z,
  )}`;
}

function getNightStrength(timeOfDay: number): number {
  const hour = ((timeOfDay % 24) + 24) % 24;
  const distanceFromMidnight = Math.min(hour, 24 - hour);
  // Full strength within ~3h of midnight, fading out toward 7h so deep night
  // reads consistently instead of peaking only at exactly 0:00.
  return Math.max(0, Math.min(1, (7 - distanceFromMidnight) / 4));
}

function createGlowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const gradient = ctx.createRadialGradient(32, 32, 1, 32, 32, 32);
    gradient.addColorStop(0, "rgba(255,255,255,0.62)");
    gradient.addColorStop(0.18, "rgba(255,255,255,0.5)");
    gradient.addColorStop(0.58, "rgba(255,255,255,0.14)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
  }
  return new THREE.CanvasTexture(canvas);
}
