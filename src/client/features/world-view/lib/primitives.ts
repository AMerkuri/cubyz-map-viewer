import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

import { LOD_BORDER_COLORS } from "./constants.js";
import {
  type FormattedPlayerNameSegment,
  parseFormattedPlayerName,
} from "./utils.js";

export function getLodBorderColor(lod: number): {
  line: number;
  label: string;
} {
  return LOD_BORDER_COLORS[lod] ?? { line: 0xffffff, label: "#ffffff" };
}

export function createTextSprite(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    const texture = new THREE.CanvasTexture(canvas);
    return new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
      }),
    );
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
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(60, 15, 1);
  return sprite;
}

export function createMarkerDot(color: string, sizePx: number): CSS2DObject {
  const div = document.createElement("div");
  div.style.cssText = [
    `width: ${sizePx}px`,
    `height: ${sizePx}px`,
    "transform: translate(-50%, -50%)",
    "border-radius: 999px",
    `background: ${color}`,
    "border: 1px solid rgba(255,255,255,0.75)",
    "box-shadow: 0 0 8px rgba(0,0,0,0.55)",
    "pointer-events: none",
  ].join(";");
  return new CSS2DObject(div);
}

export function createMarkerLabel(text: string, color: string): CSS2DObject {
  const div = document.createElement("div");
  div.textContent = text;
  div.style.cssText = [
    `color: ${color}`,
    "font-size: 20px",
    "font-weight: 700",
    "transform: translate(-50%, calc(-100% - 10px))",
    "text-shadow: 0 0 4px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.55)",
    "pointer-events: none",
    "white-space: nowrap",
  ].join(";");
  return new CSS2DObject(div);
}

export function createFormattedPlayerLabel(name: string): CSS2DObject {
  const div = document.createElement("div");
  const segments = parseFormattedPlayerName(name);

  div.style.cssText = [
    "transform: translate(-50%, calc(-100% - 10px))",
    "font-size: 20px",
    "font-weight: 700",
    "text-shadow: 0 0 4px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.55)",
    "pointer-events: none",
    "white-space: nowrap",
  ].join(";");

  for (const segment of segments) {
    appendPlayerLabelSegment(div, segment);
  }

  return new CSS2DObject(div);
}

function appendPlayerLabelSegment(
  parent: HTMLDivElement,
  segment: FormattedPlayerNameSegment,
) {
  const span = document.createElement("span");
  span.textContent = segment.text;
  span.style.color = segment.color ?? "#e6e8ed";
  parent.appendChild(span);
}

export function createPlayerMarkerModel(
  template: THREE.Object3D,
  texture: THREE.Texture,
): THREE.Object3D {
  const model = template.clone(true);

  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.material = new THREE.MeshLambertMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.1,
      side: THREE.DoubleSide,
    });
    child.castShadow = false;
    child.receiveShadow = false;
    child.renderOrder = 20;
    child.userData.playerMarker = true;
  });

  model.scale.setScalar(4.5);
  return model;
}

export function disposePlayerMarkerModel(model: THREE.Object3D) {
  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const material = child.material;
    if (Array.isArray(material)) {
      for (const mat of material) {
        mat.dispose();
      }
      return;
    }
    material.dispose();
  });
}

export function disposeTextSprite(sprite: THREE.Sprite) {
  const mat = sprite.material as THREE.SpriteMaterial;
  mat.map?.dispose();
  mat.dispose();
}
