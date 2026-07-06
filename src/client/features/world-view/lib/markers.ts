import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import type { PlayerData } from "../hooks/usePlayers.js";

import { createFallbackPlayerMarker } from "./primitives.js";
import { worldToScene } from "./utils.js";

const PLAYER_LABEL_HEADROOM = 1.5;
const DOT_LABEL_PIXEL_OFFSET = 40;
const PLAYER_GROUND_OFFSET_RATIO = 0.3;
const PLAYER_GROUND_OFFSET_CLEARANCE = 0.1;

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

interface PlayerMarkerState {
  visualRoot: THREE.Group;
  marker: THREE.Object3D | CSS2DObject;
  label: CSS2DObject;
  grayscale: boolean;
  underground: boolean;
  depthCue: string | null;
  usesModel: boolean;
  avatarModelId: string | null;
}

/**
 * Resolves the avatar marker object for a player. Returns `null` when no
 * loadable avatar model is available so the caller falls back to a dot marker.
 * `avatarModelId` identifies which avatar model backed the returned object (or
 * `null` for a fallback) so markers can be recreated when the avatar changes.
 */
interface PlayerMarkerResolution {
  object: THREE.Object3D | CSS2DObject | null;
  avatarModelId: string | null;
}

/**
 * Lightweight identity of the marker a player would get, used to decide whether
 * an existing marker needs to be recreated without cloning any geometry.
 */
interface PlayerMarkerIdentity {
  usesModel: boolean;
  avatarModelId: string | null;
}

function isPlayerUnderground(player: PlayerData): boolean {
  return player.position[2] < 0;
}

function getPlayerDepthCue(player: PlayerData): string | null {
  if (!isPlayerUnderground(player)) {
    return null;
  }
  return `Below ground: Z ${Math.round(player.position[2])}`;
}

function getModelLabelOffset(marker: THREE.Object3D): number {
  const bounds = new THREE.Box3().setFromObject(marker);
  return Math.max(bounds.max.z, 0) + PLAYER_LABEL_HEADROOM;
}

function getModelGroundOffset(marker: THREE.Object3D): number {
  if (typeof marker.userData.playerMarkerGroundOffset === "number") {
    return Math.max(marker.userData.playerMarkerGroundOffset, 0);
  }
  const bounds = new THREE.Box3().setFromObject(marker);
  return Math.max(
    bounds.max.z * PLAYER_GROUND_OFFSET_RATIO - PLAYER_GROUND_OFFSET_CLEARANCE,
    0,
  );
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

function disposeMarkerObject(args: {
  object: THREE.Object3D;
  disposePlayerMarkerModel: (model: THREE.Object3D) => void;
  disposeTextSprite: (sprite: THREE.Sprite) => void;
}) {
  const { object, disposePlayerMarkerModel, disposeTextSprite } = args;
  if (object.parent) {
    object.parent.remove(object);
  }
  disposeMarkerTree({
    root: object,
    disposePlayerMarkerModel,
    disposeTextSprite,
  });
}

function createPlayerMarkerVisuals(args: {
  player: PlayerData;
  resolvePlayerMarker: (player: PlayerData) => PlayerMarkerResolution;
  createFormattedPlayerLabel: (
    text: string,
    grayscale?: boolean,
    depthCue?: string | null,
    pixelOffset?: number,
  ) => CSS2DObject;
}) {
  const { player, resolvePlayerMarker, createFormattedPlayerLabel } = args;
  const grayscale = !player.isActive;
  const underground = isPlayerUnderground(player);
  const resolution = resolvePlayerMarker(player);
  const marker = resolution.object ?? createFallbackPlayerMarker(grayscale);
  const usesModel = !(marker instanceof CSS2DObject);
  const avatarModelId = usesModel ? resolution.avatarModelId : null;
  const groundOffsetBase = usesModel ? getModelGroundOffset(marker) : 0;
  const label = createFormattedPlayerLabel(
    player.name,
    grayscale,
    getPlayerDepthCue(player),
    usesModel ? 4 : DOT_LABEL_PIXEL_OFFSET,
  );
  const depthCue = getPlayerDepthCue(player);
  const labelBaseOffset = usesModel ? getModelLabelOffset(marker) : 0;

  label.userData.player = player;
  label.position.set(0, 0, labelBaseOffset);

  updatePlayerMarkerObject(marker, player);

  return {
    marker,
    label,
    grayscale,
    underground,
    depthCue,
    usesModel,
    avatarModelId,
    labelBaseOffset,
    groundOffsetBase,
  };
}

function updatePlayerMarkerObject(
  marker: THREE.Object3D | CSS2DObject,
  player: PlayerData,
) {
  marker.position.set(0, 0, 0);
  // The GLB marker template faces opposite Cubyz entity yaw after z-up conversion.
  marker.rotation.z = Math.PI - (player.rotation[2] ?? 0);
  marker.userData.player = player;
  marker.userData.playerMarker = true;
}

function createPlayerMarkerRoot(args: {
  player: PlayerData;
  resolvePlayerMarker: (player: PlayerData) => PlayerMarkerResolution;
  createFormattedPlayerLabel: (
    text: string,
    grayscale?: boolean,
    depthCue?: string | null,
    pixelOffset?: number,
  ) => CSS2DObject;
}): THREE.Group {
  const { player, resolvePlayerMarker, createFormattedPlayerLabel } = args;
  const [px, py, pz] = worldToScene(
    player.position[0],
    player.position[1],
    player.position[2],
  );
  const root = createMarkerRoot([px, py, pz]);
  const visualRoot = createMarkerVisualRoot();
  const {
    marker,
    label,
    grayscale,
    underground,
    depthCue,
    usesModel,
    avatarModelId,
    labelBaseOffset,
    groundOffsetBase,
  } = createPlayerMarkerVisuals({
    player,
    resolvePlayerMarker,
    createFormattedPlayerLabel,
  });

  root.userData.playerMarkerRoot = true;
  root.userData.playerKey = player.name;
  visualRoot.userData.markerGroundOffsetBase = groundOffsetBase;

  visualRoot.add(marker);
  root.add(visualRoot);

  setMarkerLabelMetadata({
    label,
    visualRoot,
    baseOffset: labelBaseOffset,
    dynamicWithScale: usesModel,
  });
  root.add(label);

  root.userData.playerMarkerState = {
    visualRoot,
    marker,
    label,
    grayscale,
    underground,
    depthCue,
    usesModel,
    avatarModelId,
  } satisfies PlayerMarkerState;

  return root;
}

function updateRootMarkerScale(root: THREE.Object3D, scale: number) {
  for (const nestedChild of root.children) {
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
    const groundOffsetBase = nestedChild.userData.markerGroundOffsetBase;
    if (typeof groundOffsetBase === "number") {
      // The player position Z is the feet, which can sit a fraction of a block
      // above the surface block top. Seat the (bottom-aligned) avatar model on
      // that block top so it rests on the ground instead of floating, while the
      // fallback dot keeps its offset of 0.
      const groundSeatOffset = root.position.z - Math.floor(root.position.z);
      nestedChild.position.z = -(groundOffsetBase * scale + groundSeatOffset);
    }
  }

  for (const nestedChild of root.children) {
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
      visualRoot.parent !== root
    ) {
      continue;
    }
    const groundOffsetBase =
      (visualRoot.userData.markerGroundOffsetBase as number | undefined) ?? 0;
    nestedChild.position.z = dynamicWithScale
      ? (baseOffset - groundOffsetBase) * scale
      : baseOffset - groundOffsetBase;
  }
}

function updateGroupMarkerScale(
  group: THREE.Group | null,
  getScale: (root: THREE.Object3D) => number,
) {
  if (!group) {
    return;
  }

  for (const child of group.children) {
    if (!(child instanceof THREE.Object3D) || child instanceof CSS2DObject) {
      continue;
    }
    updateRootMarkerScale(child, getScale(child));
  }
}

export function updatePlayerMarkerScale(
  markerGroup: THREE.Group | null,
  getScale: (root: THREE.Object3D) => number,
) {
  updateGroupMarkerScale(markerGroup, getScale);
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

export function syncPlayerMarkers(args: {
  players: PlayerData[];
  markerGroup: THREE.Group | null;
  resolvePlayerMarker: (player: PlayerData) => PlayerMarkerResolution;
  getPlayerMarkerIdentity: (player: PlayerData) => PlayerMarkerIdentity;
  createFormattedPlayerLabel: (
    text: string,
    grayscale?: boolean,
    depthCue?: string | null,
    pixelOffset?: number,
  ) => CSS2DObject;
  disposePlayerMarkerModel: (model: THREE.Object3D) => void;
  disposeTextSprite: (sprite: THREE.Sprite) => void;
}): void {
  const {
    players,
    markerGroup,
    resolvePlayerMarker,
    getPlayerMarkerIdentity,
    createFormattedPlayerLabel,
    disposePlayerMarkerModel,
    disposeTextSprite,
  } = args;
  if (!markerGroup) return;

  const existingRoots = new Map<string, THREE.Group>();
  for (const child of markerGroup.children) {
    if (!(child instanceof THREE.Group)) {
      continue;
    }
    if (child.userData.playerMarkerRoot !== true) {
      continue;
    }
    const key = child.userData.playerKey;
    if (typeof key === "string") {
      existingRoots.set(key, child);
    }
  }

  const seenKeys = new Set<string>();

  for (const player of players) {
    const key = player.name;
    seenKeys.add(key);

    const [px, py, pz] = worldToScene(
      player.position[0],
      player.position[1],
      player.position[2],
    );
    const root = existingRoots.get(key);
    if (!root) {
      markerGroup.add(
        createPlayerMarkerRoot({
          player,
          resolvePlayerMarker,
          createFormattedPlayerLabel,
        }),
      );
      continue;
    }

    root.position.set(px, py, pz);
    root.userData.playerKey = key;

    const state = root.userData.playerMarkerState as
      | PlayerMarkerState
      | undefined;
    if (
      !state ||
      state.visualRoot.parent !== root ||
      state.label.parent !== root
    ) {
      disposeMarkerObject({
        object: root,
        disposePlayerMarkerModel,
        disposeTextSprite,
      });
      markerGroup.add(
        createPlayerMarkerRoot({
          player,
          resolvePlayerMarker,
          createFormattedPlayerLabel,
        }),
      );
      continue;
    }

    const grayscale = !player.isActive;
    const underground = isPlayerUnderground(player);
    const depthCue = getPlayerDepthCue(player);
    const identity = getPlayerMarkerIdentity(player);
    const shouldUseModel = identity.usesModel;
    const nextAvatarModelId = identity.usesModel
      ? identity.avatarModelId
      : null;
    if (
      state.grayscale !== grayscale ||
      state.underground !== underground ||
      state.depthCue !== depthCue ||
      state.usesModel !== shouldUseModel ||
      state.avatarModelId !== nextAvatarModelId
    ) {
      disposeMarkerObject({
        object: state.marker,
        disposePlayerMarkerModel,
        disposeTextSprite,
      });
      disposeMarkerObject({
        object: state.label,
        disposePlayerMarkerModel,
        disposeTextSprite,
      });

      const {
        marker,
        label,
        grayscale: nextGrayscale,
        underground: nextUnderground,
        depthCue: nextDepthCue,
        usesModel,
        avatarModelId,
        labelBaseOffset,
        groundOffsetBase,
      } = createPlayerMarkerVisuals({
        player,
        resolvePlayerMarker,
        createFormattedPlayerLabel,
      });

      state.visualRoot.add(marker);
      state.visualRoot.userData.markerGroundOffsetBase = groundOffsetBase;
      setMarkerLabelMetadata({
        label,
        visualRoot: state.visualRoot,
        baseOffset: labelBaseOffset,
        dynamicWithScale: usesModel,
      });
      root.add(label);

      root.userData.playerMarkerState = {
        visualRoot: state.visualRoot,
        marker,
        label,
        grayscale: nextGrayscale,
        underground: nextUnderground,
        depthCue: nextDepthCue,
        usesModel,
        avatarModelId,
      } satisfies PlayerMarkerState;
      continue;
    }

    updatePlayerMarkerObject(state.marker, player);
    state.label.userData.player = player;
  }

  for (const [key, root] of existingRoots) {
    if (seenKeys.has(key)) {
      continue;
    }
    markerGroup.remove(root);
    disposeMarkerTree({
      root,
      disposePlayerMarkerModel,
      disposeTextSprite,
    });
  }
}
