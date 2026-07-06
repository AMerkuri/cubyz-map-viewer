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

export function createFallbackPlayerMarker(
  grayscale = false,
  sizePx = 17,
): CSS2DObject {
  return createMarkerDot(grayscale ? "#5f6672d0" : "#3b82f6bc", sizePx);
}

export function createMarkerDot(color: string, sizePx: number): CSS2DObject {
  const div = document.createElement("div");
  div.style.cssText = [
    `width: ${sizePx}px`,
    `height: ${sizePx}px`,
    "border-radius: 5px",
    `background: ${color}`,
    "border: 2px solid rgba(255,255,255,0.78)",
    "box-shadow: 0 0 8px rgba(0,0,0,0.55)",
    "pointer-events: none",
  ].join(";");
  const marker = new CSS2DObject(div);
  marker.center.set(0.5, 0.5);
  return marker;
}

export function createMarkerLabel(
  text: string,
  color: string,
  pixelOffset = 4,
): CSS2DObject {
  const wrapper = document.createElement("div");
  wrapper.style.cssText = [
    "width: 0",
    "height: 0",
    "pointer-events: none",
  ].join(";");

  const div = document.createElement("div");
  div.textContent = text;
  div.style.cssText = [
    "display: inline-block",
    `color: ${color}`,
    "font-size: 20px",
    "font-family: 'Unscii', monospace",
    "font-weight: 700",
    "text-shadow: 0 0 4px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.55)",
    "white-space: nowrap",
    `transform: translate(-50%, calc(-100% - ${pixelOffset}px))`,
  ].join(";");
  wrapper.appendChild(div);

  const label = new CSS2DObject(wrapper);
  label.center.set(0.5, 1);
  return label;
}

export function createFormattedPlayerLabel(
  name: string,
  grayscale = false,
  depthCue: string | null = null,
  pixelOffset = 4,
): CSS2DObject {
  const wrapper = document.createElement("div");
  wrapper.style.cssText = [
    "width: 0",
    "height: 0",
    "pointer-events: none",
  ].join(";");

  const div = document.createElement("div");
  div.style.cssText = [
    "display: inline-block",
    "text-align: center",
    "font-size: 20px",
    "font-family: 'Unscii', monospace",
    "font-weight: 700",
    "text-shadow: 0 0 4px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.55)",
    "white-space: nowrap",
    grayscale ? "filter: grayscale(1)" : "",
    `transform: translate(-50%, calc(-100% - ${pixelOffset}px))`,
  ].join(";");

  const nameRow = document.createElement("div");
  nameRow.style.cssText = [
    "display: inline-block",
    "white-space: nowrap",
    "text-align: center",
  ].join(";");

  const segments = parseFormattedPlayerName(name);

  for (const segment of segments) {
    appendPlayerLabelSegment(nameRow, segment, grayscale);
  }

  div.appendChild(nameRow);

  if (depthCue) {
    const depth = document.createElement("div");
    depth.textContent = depthCue;
    depth.style.color = "#aab5c1";
    depth.style.fontSize = "10px";
    depth.style.fontWeight = "600";
    depth.style.marginTop = "5px";
    depth.style.letterSpacing = "0.02em";
    depth.style.textAlign = "center";
    depth.style.whiteSpace = "nowrap";
    div.appendChild(depth);
  }

  wrapper.appendChild(div);

  const label = new CSS2DObject(wrapper);
  label.center.set(0.5, 1);
  return label;
}

function appendPlayerLabelSegment(
  parent: HTMLDivElement,
  segment: FormattedPlayerNameSegment,
  grayscale: boolean,
) {
  const span = document.createElement("span");
  span.textContent = segment.text;
  span.style.color = grayscale ? "#7a808a" : (segment.color ?? "#e6e8ed");
  parent.appendChild(span);
}

export function createGrayscaleTexture(texture: THREE.Texture): THREE.Texture {
  const sourceImage = texture.image as
    | HTMLImageElement
    | HTMLCanvasElement
    | ImageBitmap
    | OffscreenCanvas
    | undefined;
  if (!sourceImage) {
    const clonedTexture = texture.clone();
    clonedTexture.needsUpdate = true;
    return clonedTexture;
  }

  const width =
    sourceImage instanceof HTMLImageElement
      ? sourceImage.naturalWidth
      : sourceImage.width;
  const height =
    sourceImage instanceof HTMLImageElement
      ? sourceImage.naturalHeight
      : sourceImage.height;

  if (width <= 0 || height <= 0) {
    const clonedTexture = texture.clone();
    clonedTexture.needsUpdate = true;
    return clonedTexture;
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    const clonedTexture = texture.clone();
    clonedTexture.needsUpdate = true;
    return clonedTexture;
  }

  ctx.drawImage(sourceImage, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  const { data } = imageData;
  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round(
      data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114,
    );
    data[i] = gray;
    data[i + 1] = gray;
    data[i + 2] = gray;
  }
  ctx.putImageData(imageData, 0, 0);

  const grayscaleTexture = new THREE.CanvasTexture(canvas);
  grayscaleTexture.colorSpace = texture.colorSpace;
  grayscaleTexture.magFilter = texture.magFilter;
  grayscaleTexture.minFilter = texture.minFilter;
  grayscaleTexture.wrapS = texture.wrapS;
  grayscaleTexture.wrapT = texture.wrapT;
  grayscaleTexture.generateMipmaps = texture.generateMipmaps;
  // Match the source texture's vertical orientation. The grayscale canvas is
  // drawn from an already-oriented source, so re-flipping would double-flip.
  grayscaleTexture.flipY = false;
  grayscaleTexture.needsUpdate = true;
  return grayscaleTexture;
}

export function createPlayerMarkerModel(
  template: THREE.Object3D,
  texture: THREE.Texture,
  underground = false,
): THREE.Object3D {
  const model = template.clone(true);

  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.material = clonePlayerMarkerMaterial(
      child.material,
      texture,
      underground,
    );
    child.castShadow = false;
    child.receiveShadow = false;
    child.renderOrder = 20;
    child.userData.playerMarker = true;
  });

  model.scale.setScalar(
    typeof template.userData.playerMarkerBaseScale === "number"
      ? template.userData.playerMarkerBaseScale
      : 1.75,
  );
  return model;
}

function clonePlayerMarkerMaterial(
  material: THREE.Material | THREE.Material[],
  markerTexture: THREE.Texture,
  underground: boolean,
): THREE.Material | THREE.Material[] {
  if (Array.isArray(material)) {
    return material.map(() =>
      createSinglePlayerMarkerMaterial(markerTexture, underground),
    );
  }
  return createSinglePlayerMarkerMaterial(markerTexture, underground);
}

/**
 * Cubyz renders entity models unlit with the entity's own default texture bound
 * to every mesh regardless of the GLB material. Some avatar GLBs (cubert,
 * snail, moffalo) ship no materials at all, so relying on the imported material
 * leaves them untextured and lighting-dependent. Build an unlit basic material
 * that always samples the manifest texture to match Cubyz.
 */
function createSinglePlayerMarkerMaterial(
  markerTexture: THREE.Texture,
  underground: boolean,
): THREE.Material {
  const material = new THREE.MeshBasicMaterial({
    map: markerTexture,
    transparent: true,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: true,
    opacity: underground ? 0.6 : 1,
  });
  return material;
}

export function disposePlayerMarkerTemplate(template: THREE.Object3D) {
  template.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const material = child.material;
    if (Array.isArray(material)) {
      for (const mat of material) {
        mat.map?.dispose();
        mat.dispose();
      }
    } else {
      material.map?.dispose();
      material.dispose();
    }
    child.geometry.dispose();
  });
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
