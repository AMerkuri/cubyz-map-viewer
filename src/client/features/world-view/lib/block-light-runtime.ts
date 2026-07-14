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
  accentsEnabled: boolean;
}

export interface BlockLightRuntimeStats {
  decodedEmitters: number;
  activeEmitters: number;
  budget: number;
  glowBudget: number;
  pointLightBudget: number;
  glowPoolAllocated: number;
  glowPoolUsed: number;
  pointLightPoolAllocated: number;
  poolMemoryBytes: number;
  runtimeMs: number;
  degraded: boolean;
}

export class BlockLightRuntimeManager {
  private readonly regions = new Map<string, RegionEffects>();
  private readonly lights: THREE.PointLight[] = [];
  private readonly texture = createGlowTexture();
  private readonly glowSprites: THREE.Sprite[] = [];
  private readonly selectedEmitters: VoxelEmitterRecord[] = [];
  private readonly selectedDistances: number[] = [];
  private decodedEmitters = 0;
  private accentsActive = false;
  private stats: BlockLightRuntimeStats = {
    decodedEmitters: 0,
    activeEmitters: 0,
    budget: 0,
    glowBudget: 0,
    pointLightBudget: 0,
    glowPoolAllocated: 0,
    glowPoolUsed: 0,
    pointLightPoolAllocated: 0,
    poolMemoryBytes: 0,
    runtimeMs: 0,
    degraded: false,
  };

  constructor(private readonly scene: THREE.Scene) {
    for (let i = 0; i < HIGH_GLOW_BUDGET; i++) {
      const material = new THREE.SpriteMaterial({
        map: this.texture,
        transparent: true,
        depthWrite: false,
        opacity: 0,
        blending: THREE.NormalBlending,
        depthTest: true,
      });
      const sprite = new THREE.Sprite(material);
      sprite.visible = false;
      this.scene.add(sprite);
      this.glowSprites.push(sprite);
    }
  }

  syncRegions(loadedVoxels: Iterable<LoadedVoxelTile>): void {
    const seen = new Set<string>();
    for (const tile of loadedVoxels) {
      seen.add(tile.key);
      const existing = this.regions.get(tile.key);
      if (existing?.emitters === tile.emitterRecords) continue;
      this.regions.set(tile.key, {
        emitters: tile.emitterRecords,
        // Coarse records are aggregate centroids used for mesh-local lighting,
        // not physical source blocks where an accent can be placed.
        accentsEnabled: tile.lod === 1,
      });
    }

    for (const key of [...this.regions.keys()]) {
      if (!seen.has(key)) this.regions.delete(key);
    }
    this.decodedEmitters = 0;
    for (const region of this.regions.values()) {
      this.decodedEmitters += region.emitters.length;
    }
  }

  update(args: {
    enabled: boolean;
    quality: number;
    timeOfDay: number;
    cameraPosition: THREE.Vector3;
  }): BlockLightRuntimeStats {
    const runtimeStart = performance.now();
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
    if (!args.enabled || nightStrength <= 0 || visibleBudget === 0) {
      if (this.accentsActive) this.hideAccents();
      this.stats = this.createStats({
        decodedEmitters: this.decodedEmitters,
        activeEmitters: 0,
        visibleBudget,
        glowBudget,
        lightBudget,
        runtimeStart,
      });
      return this.stats;
    }

    this.accentsActive = true;
    this.selectNearestEmitters(args.cameraPosition, visibleBudget);
    for (let i = 0; i < this.glowSprites.length; i++) {
      const sprite = this.glowSprites[i];
      const emitter = i < glowBudget ? this.selectedEmitters[i] : undefined;
      if (!emitter) {
        sprite.visible = false;
        continue;
      }
      sprite.visible = true;
      sprite.position.set(emitter.x, emitter.y, emitter.z);
      const radiusScale = Math.min(2.25, Math.sqrt(emitter.radius / 12));
      const powerOpacity = Math.min(1.75, emitter.power ** 0.25);
      sprite.scale.setScalar((1.15 + 0.85 * nightStrength) * radiusScale);
      const material = sprite.material as THREE.SpriteMaterial;
      material.color.setRGB(emitter.r / 255, emitter.g / 255, emitter.b / 255);
      material.opacity = Math.min(
        0.32,
        (0.08 + 0.1 * nightStrength) * powerOpacity,
      );
    }

    this.ensureLightPool(lightBudget);
    for (let i = 0; i < this.lights.length; i++) {
      const light = this.lights[i];
      const emitter = this.selectedEmitters[i];
      if (!emitter || i >= lightBudget || nightStrength <= 0) {
        light.visible = false;
        continue;
      }
      light.visible = true;
      light.position.set(emitter.x, emitter.y, emitter.z);
      light.color.setRGB(emitter.r / 255, emitter.g / 255, emitter.b / 255);
      // Accent intensity: local surface illumination is baked into the mesh,
      // so the pooled lights only add nearby dynamic sparkle.
      light.intensity =
        0.16 * nightStrength * Math.min(2, Math.sqrt(emitter.power));
      light.distance = Math.min(32, 14 * Math.sqrt(emitter.radius / 12));
    }

    this.stats = this.createStats({
      decodedEmitters: this.decodedEmitters,
      activeEmitters: this.selectedEmitters.length,
      visibleBudget,
      glowBudget,
      lightBudget,
      runtimeStart,
    });
    return this.stats;
  }

  getStats(): BlockLightRuntimeStats {
    return this.stats;
  }

  dispose(): void {
    setMeshBlockLightStrength(0);
    this.regions.clear();
    for (const sprite of this.glowSprites) {
      this.scene.remove(sprite);
      (sprite.material as THREE.SpriteMaterial).dispose();
    }
    this.glowSprites.length = 0;
    for (const light of this.lights) this.scene.remove(light);
    this.lights.length = 0;
    this.texture.dispose();
  }

  private selectNearestEmitters(
    cameraPosition: THREE.Vector3,
    budget: number,
  ): void {
    this.selectedEmitters.length = 0;
    this.selectedDistances.length = 0;
    for (const region of this.regions.values()) {
      if (!region.accentsEnabled) continue;
      for (const emitter of region.emitters) {
        const distance = cameraPosition.distanceToSquared(
          TEMP_POSITION.set(emitter.x, emitter.y, emitter.z),
        );
        let insertAt = this.selectedDistances.length;
        while (
          insertAt > 0 &&
          (distance < this.selectedDistances[insertAt - 1] ||
            (distance === this.selectedDistances[insertAt - 1] &&
              compareEmitterIdentity(
                emitter,
                this.selectedEmitters[insertAt - 1],
              ) < 0))
        ) {
          insertAt--;
        }
        if (insertAt >= budget) continue;
        this.selectedDistances.splice(insertAt, 0, distance);
        this.selectedEmitters.splice(insertAt, 0, emitter);
        if (this.selectedEmitters.length > budget) {
          this.selectedDistances.pop();
          this.selectedEmitters.pop();
        }
      }
    }
  }

  private hideAccents(): void {
    this.accentsActive = false;
    for (const sprite of this.glowSprites) sprite.visible = false;
    for (const light of this.lights) light.visible = false;
  }

  private createStats(args: {
    decodedEmitters: number;
    activeEmitters: number;
    visibleBudget: number;
    glowBudget: number;
    lightBudget: number;
    runtimeStart: number;
  }): BlockLightRuntimeStats {
    return {
      decodedEmitters: args.decodedEmitters,
      activeEmitters: args.activeEmitters,
      budget: args.visibleBudget,
      glowBudget: args.glowBudget,
      pointLightBudget: args.lightBudget,
      glowPoolAllocated: this.glowSprites.length,
      glowPoolUsed: Math.min(args.activeEmitters, args.glowBudget),
      pointLightPoolAllocated: this.lights.length,
      poolMemoryBytes:
        64 * 64 * 4 + this.glowSprites.length * 512 + this.lights.length * 512,
      runtimeMs: performance.now() - args.runtimeStart,
      degraded: args.decodedEmitters > args.visibleBudget,
    };
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

function compareEmitterIdentity(
  a: VoxelEmitterRecord,
  b: VoxelEmitterRecord,
): number {
  return (
    a.x - b.x ||
    a.y - b.y ||
    a.z - b.z ||
    a.r - b.r ||
    a.g - b.g ||
    a.b - b.b ||
    a.radius - b.radius ||
    a.power - b.power
  );
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
