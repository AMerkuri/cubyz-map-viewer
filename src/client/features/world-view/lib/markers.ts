import * as THREE from "three";
import type { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import type { PlayerData } from "../hooks/usePlayers.js";

import { worldToScene } from "./utils.js";

export function rebuildSpawnMarker(args: {
  spawn: [number, number, number] | null | undefined;
  spawnGroup: THREE.Group | null;
  createMarkerDot: (color: string, sizePx: number) => CSS2DObject;
  createMarkerLabel: (text: string, color: string) => CSS2DObject;
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
    if (child instanceof THREE.Sprite) {
      disposeTextSprite(child);
    }
  }

  const [sx, sy, sz] = worldToScene(spawn[0], spawn[1], spawn[2]);
  const dot = createMarkerDot("#ff4444", 17);
  dot.position.set(sx, sy, sz);
  spawnGroup.add(dot);

  const label = createMarkerLabel("Spawn", "#ff6b6b");
  label.position.set(sx, sy, sz + 24);
  spawnGroup.add(label);
}

export function rebuildPlayerMarkers(args: {
  players: PlayerData[];
  markerGroup: THREE.Group | null;
  createPlayerMarkerModel: () => THREE.Object3D;
  createFormattedPlayerLabel: (text: string) => CSS2DObject;
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
    if (child instanceof THREE.Sprite) {
      disposeTextSprite(child);
    } else {
      disposePlayerMarkerModel(child);
    }
  }

  for (const player of players) {
    const [px, py, pz] = worldToScene(
      player.position[0],
      player.position[1],
      player.position[2],
    );

    const marker = createPlayerMarkerModel();
    marker.position.set(px, py, pz);
    // Scene Y is mirrored, so player yaw needs a half-turn offset to stay aligned.
    marker.rotation.z = (player.rotation[2] ?? 0) + Math.PI;
    marker.userData.player = player;
    marker.userData.playerMarker = true;
    markerGroup.add(marker);

    const label = createFormattedPlayerLabel(player.name);
    label.position.set(px, py, pz + 24);
    markerGroup.add(label);
  }
}
