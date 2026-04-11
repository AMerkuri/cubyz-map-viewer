import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

import { LOD_BORDER_COLORS } from "./constants.js";

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

export function disposeTextSprite(sprite: THREE.Sprite) {
  const mat = sprite.material as THREE.SpriteMaterial;
  mat.map?.dispose();
  mat.dispose();
}
