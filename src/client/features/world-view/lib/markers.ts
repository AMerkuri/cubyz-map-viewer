import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import type { PlayerData } from "../hooks/usePlayers.js";

import { createFallbackPlayerMarker } from "./primitives.js";
import { worldToScene } from "./utils.js";

const PLAYER_ACTIVE_WINDOW_MS = 60_000;
const PLAYER_LABEL_HEADROOM = 3.5;
const DOT_LABEL_PIXEL_OFFSET = 40;

function createMarkerRoot(position: [number, number, number]): THREE.Group {
  const root = new THREE.Group();
  root.position.set(position[0], position[1], position[2]);
  return root;
}

function createMarkerVisualRoot(): THREE.Group {
  const visualRoot = new THREE.Group();
  visualRoot.userData.markerScalable = true;
  return visualRoot;
}

function getModelLabelOffset(marker: THREE.Object3D): number {
  const bounds = new THREE.Box3().setFromObject(marker);
  return Math.max(bounds.max.z, 0) + PLAYER_LABEL_HEADROOM;
}

function setMarkerLabelMetadata(args: {
  label: CSS2DObject;
  visualRoot: THREE.Group;
  baseOffset: number;
  dynamicWithScale?: boolean;
}) {
  const { label, visualRoot, baseOffset, dynamicWithScale = false } = args;
  label.userData.markerLabel = true;
  label.userData.markerLabelVisualRoot = visualRoot;
  label.userData.markerLabelBaseOffset = baseOffset;
  label.userData.markerLabelDynamicWithScale = dynamicWithScale;
}

function disposeMarkerTree(args: {
  root: THREE.Object3D;
  disposePlayerMarkerModel: (model: THREE.Object3D) => void;
  disposeTextSprite: (sprite: THREE.Sprite) => void;
}) {
  const { root, disposePlayerMarkerModel, disposeTextSprite } = args;
  root.traverse((child) => {
    if (child instanceof CSS2DObject) {
      child.element.remove();
      return;
    }
    if (child instanceof THREE.Sprite) {
      disposeTextSprite(child);
      return;
    }
    if (child.userData.playerMarker === true) {
      disposePlayerMarkerModel(child);
    }
  });
}

function updateGroupMarkerScale(group: THREE.Group | null, scale: number) {
  if (!group) {
    return;
  }

  for (const child of group.children) {
    if (!(child instanceof THREE.Object3D) || child instanceof CSS2DObject) {
      continue;
    }

    for (const nestedChild of child.children) {
      if (
        !(nestedChild instanceof THREE.Object3D) ||
        nestedChild instanceof CSS2DObject
      ) {
        continue;
      }
      if (nestedChild.userData.markerScalable !== true) {
        continue;
      }
      nestedChild.scale.setScalar(scale);
    }

    for (const nestedChild of child.children) {
      if (!(nestedChild instanceof CSS2DObject)) {
        continue;
      }
      const visualRoot = nestedChild.userData.markerLabelVisualRoot as
        | THREE.Group
        | undefined;
      const baseOffset = nestedChild.userData.markerLabelBaseOffset;
      const dynamicWithScale =
        nestedChild.userData.markerLabelDynamicWithScale === true;
      if (
        !visualRoot ||
        typeof baseOffset !== "number" ||
        visualRoot.parent !== child
      ) {
        continue;
      }
      nestedChild.position.z = dynamicWithScale
        ? baseOffset * scale
        : baseOffset;
    }
  }
}

export function updatePlayerMarkerScale(
  markerGroup: THREE.Group | null,
  scale: number,
) {
  updateGroupMarkerScale(markerGroup, scale);
}

export function rebuildSpawnMarker(args: {
  spawn: [number, number, number] | null | undefined;
  spawnGroup: THREE.Group | null;
  createMarkerDot: (color: string, sizePx: number) => CSS2DObject;
  createMarkerLabel: (
    text: string,
    color: string,
    pixelOffset?: number,
  ) => CSS2DObject;
  disposeTextSprite: (sprite: THREE.Sprite) => void;
}): void {
  const {
    spawn,
    spawnGroup,
    createMarkerDot,
    createMarkerLabel,
    disposeTextSprite,
  } = args;
  if (!spawn || !spawnGroup) return;

  while (spawnGroup.children.length > 0) {
    const child = spawnGroup.children[0];
    spawnGroup.remove(child);
    disposeMarkerTree({
      root: child,
      disposePlayerMarkerModel: () => {},
      disposeTextSprite,
    });
  }

  const [sx, sy, sz] = worldToScene(spawn[0], spawn[1], spawn[2]);
  const root = createMarkerRoot([sx, sy, sz]);
  const visualRoot = createMarkerVisualRoot();

  const dot = createMarkerDot("#ff4444bc", 17);
  dot.position.set(0, 0, 0);
  visualRoot.add(dot);
  root.add(visualRoot);

  const label = createMarkerLabel("Spawn", "#ff6b6b", DOT_LABEL_PIXEL_OFFSET);
  label.position.set(0, 0, 0);
  setMarkerLabelMetadata({ label, visualRoot, baseOffset: 0 });
  root.add(label);

  spawnGroup.add(root);
}

export function rebuildPlayerMarkers(args: {
  players: PlayerData[];
  markerGroup: THREE.Group | null;
  createPlayerMarkerModel: (
    player: PlayerData,
  ) => THREE.Object3D | CSS2DObject | null;
  createFormattedPlayerLabel: (
    text: string,
    grayscale?: boolean,
    pixelOffset?: number,
  ) => CSS2DObject;
  disposePlayerMarkerModel: (model: THREE.Object3D) => void;
  disposeTextSprite: (sprite: THREE.Sprite) => void;
}): void {
  const {
    players,
    markerGroup,
    createPlayerMarkerModel,
    createFormattedPlayerLabel,
    disposePlayerMarkerModel,
    disposeTextSprite,
  } = args;
  if (!markerGroup) return;

  while (markerGroup.children.length > 0) {
    const child = markerGroup.children[0];
    markerGroup.remove(child);
    disposeMarkerTree({
      root: child,
      disposePlayerMarkerModel,
      disposeTextSprite,
    });
  }

  for (const player of players) {
    const [px, py, pz] = worldToScene(
      player.position[0],
      player.position[1],
      player.position[2],
    );

    const grayscale = Date.now() - player.lastSeen > PLAYER_ACTIVE_WINDOW_MS;
    const marker =
      createPlayerMarkerModel(player) ?? createFallbackPlayerMarker(grayscale);
    const usesModel = !(marker instanceof CSS2DObject);
    const root = createMarkerRoot([px, py, pz]);
    root.userData.playerMarkerRoot = true;
    const visualRoot = createMarkerVisualRoot();

    marker.position.set(0, 0, 0);
    // Cubyz renders entity models with rotationZ(-yaw), so match that sign here.
    marker.rotation.z = -(player.rotation[2] ?? 0);
    marker.userData.player = player;
    marker.userData.playerMarker = true;
    visualRoot.add(marker);
    root.add(visualRoot);

    const label = createFormattedPlayerLabel(
      player.name,
      grayscale,
      usesModel ? 4 : DOT_LABEL_PIXEL_OFFSET,
    );
    label.userData.player = player;
    const labelBaseOffset = usesModel ? getModelLabelOffset(marker) : 0;
    label.position.set(0, 0, labelBaseOffset);
    setMarkerLabelMetadata({
      label,
      visualRoot,
      baseOffset: labelBaseOffset,
      dynamicWithScale: usesModel,
    });
    root.add(label);

    markerGroup.add(root);
  }
}
