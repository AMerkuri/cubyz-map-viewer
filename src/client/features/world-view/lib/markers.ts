import * as THREE from "three";
import type { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import type { PlayerData } from "../hooks/usePlayers.js";

import { cleanPlayerName, worldToScene } from "./utils.js";

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
  createMarkerDot: (color: string, sizePx: number) => CSS2DObject;
  createMarkerLabel: (text: string, color: string) => CSS2DObject;
  disposeTextSprite: (sprite: THREE.Sprite) => void;
}): void {
  const {
    players,
    markerGroup,
    createMarkerDot,
    createMarkerLabel,
    disposeTextSprite,
  } = args;
  if (!markerGroup) return;

  while (markerGroup.children.length > 0) {
    const child = markerGroup.children[0];
    markerGroup.remove(child);
    if (child instanceof THREE.Sprite) {
      disposeTextSprite(child);
    }
  }

  for (const player of players) {
    const [px, py, pz] = worldToScene(
      player.position[0],
      player.position[1],
      player.position[2],
    );

    const dot = createMarkerDot("#44aaff", 15);
    dot.position.set(px, py, pz);
    markerGroup.add(dot);

    const label = createMarkerLabel(cleanPlayerName(player.name), "#6ec1ff");
    label.position.set(px, py, pz + 24);
    markerGroup.add(label);
  }
}
