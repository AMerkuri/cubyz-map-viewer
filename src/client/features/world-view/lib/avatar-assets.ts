import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import {
  createGrayscaleTexture,
  disposePlayerMarkerTemplate,
} from "./primitives.js";

/** Default avatar model ID used when a player's avatar cannot be resolved. */
export const DEFAULT_AVATAR_MODEL_ID = "cubyz:snale";

const AVATAR_LOAD_RETRY_LIMIT = 1;

interface PlayerMarkerAssetManifest {
  available: boolean;
  entityModelId: string | null;
  modelUrl: string | null;
  textureUrl: string | null;
  height: number | null;
  coordinateSystem: string | null;
}

/**
 * Per-avatar cached load state. `template` is a normalized model ready to be
 * cloned per marker; `activeTexture` and `inactiveTexture` are the color and
 * grayscale textures applied to active/inactive players respectively.
 */
export interface AvatarAssetEntry {
  state: "loading" | "loaded" | "unavailable" | "failed";
  template: THREE.Object3D | null;
  activeTexture: THREE.Texture | null;
  inactiveTexture: THREE.Texture | null;
  retryAttempts: number;
}

export type AvatarAssetCache = Map<string, AvatarAssetEntry>;

function isPlayerMarkerAssetManifest(
  value: unknown,
): value is PlayerMarkerAssetManifest {
  if (!value || typeof value !== "object") {
    return false;
  }
  const manifest = value as Partial<PlayerMarkerAssetManifest>;
  return typeof manifest.available === "boolean";
}

async function fetchAvatarManifest(
  entityModelId: string,
): Promise<PlayerMarkerAssetManifest> {
  const response = await fetch(
    `/api/assets/player-marker/${encodeURIComponent(entityModelId)}`,
  );
  if (!response.ok) {
    throw new Error(`Avatar manifest failed: ${response.status}`);
  }
  const manifest: unknown = await response.json();
  if (!isPlayerMarkerAssetManifest(manifest)) {
    throw new Error("Invalid avatar manifest");
  }
  return manifest;
}

/**
 * Cubyz entity models ship in different coordinate systems. Following the same
 * orientation handling as the reference Cubyz model viewer, `*_z_up` models are
 * authored Z-up and need an X rotation to stand upright, while `snale`
 * (`*_y_up`) is already upright and only needs a yaw offset so it faces
 * forward. The reference works in a Y-up scene; this viewer is Z-up, so the
 * whole oriented model is wrapped and rotated Y-up -> Z-up.
 */
function orientAvatarTemplate(
  template: THREE.Object3D,
  coordinateSystem: string | null,
): THREE.Object3D {
  const isZUpAuthored = coordinateSystem?.includes("z_up") ?? false;

  // Step 1: reproduce the reference viewer's per-model orientation in a Y-up
  // frame.
  if (isZUpAuthored) {
    template.rotation.x = -Math.PI / 2;
    template.rotation.y = 0;
  } else {
    template.rotation.x = 0;
    template.rotation.y = Math.PI;
  }

  const yUpOriented = new THREE.Group();
  yUpOriented.add(template);

  // Step 2: convert from the reference's Y-up frame to this viewer's Z-up scene.
  const zUpOriented = new THREE.Group();
  zUpOriented.rotation.x = Math.PI / 2;
  zUpOriented.add(yUpOriented);

  return zUpOriented;
}

function createNormalizedAvatarTemplate(
  template: THREE.Object3D,
  manifest: PlayerMarkerAssetManifest,
): THREE.Object3D {
  const oriented = orientAvatarTemplate(template, manifest.coordinateSystem);
  const normalizedRoot = new THREE.Group();
  normalizedRoot.add(oriented);

  normalizedRoot.updateMatrixWorld(true);

  const initialBounds = new THREE.Box3().setFromObject(normalizedRoot);
  const initialSize = initialBounds.getSize(new THREE.Vector3());
  const targetHeight =
    typeof manifest.height === "number" && Number.isFinite(manifest.height)
      ? manifest.height
      : null;
  if (targetHeight && initialSize.z > 0) {
    oriented.scale.multiplyScalar(targetHeight / initialSize.z);
    normalizedRoot.updateMatrixWorld(true);
  }

  const bounds = new THREE.Box3().setFromObject(normalizedRoot);
  oriented.position.x -= (bounds.min.x + bounds.max.x) / 2;
  oriented.position.y -= (bounds.min.y + bounds.max.y) / 2;
  oriented.position.z -= bounds.min.z;
  normalizedRoot.userData.playerMarkerBaseScale = 1;
  // The model is bottom-aligned to local z = 0. Grounding to the surface block
  // top is handled per-frame in the marker scale update using the player's
  // fractional Z, so no fixed template offset is needed here.
  normalizedRoot.userData.playerMarkerGroundOffset = 0;
  normalizedRoot.updateMatrixWorld(true);
  return normalizedRoot;
}

function createAvatarGltfLoader(
  manifest: PlayerMarkerAssetManifest,
): GLTFLoader {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    if (!manifest.textureUrl || url === manifest.modelUrl) {
      return url;
    }
    if (url.startsWith("data:") || url.startsWith("blob:")) {
      return url;
    }
    return url.match(/\.(png|jpe?g|webp)$/i) ? manifest.textureUrl : url;
  });
  return new GLTFLoader(manager);
}

function disposeAvatarAssetEntry(entry: AvatarAssetEntry): void {
  entry.activeTexture?.dispose();
  entry.inactiveTexture?.dispose();
  if (entry.template) {
    disposePlayerMarkerTemplate(entry.template);
  }
  entry.template = null;
  entry.activeTexture = null;
  entry.inactiveTexture = null;
}

export function disposeAvatarAssetCache(cache: AvatarAssetCache): void {
  for (const entry of cache.values()) {
    disposeAvatarAssetEntry(entry);
  }
  cache.clear();
}

/**
 * Ensure the given avatar model IDs are loaded into the cache. Loading is
 * idempotent per model ID; already loading/resolved entries are skipped.
 *
 * `onChange` is invoked whenever an entry transitions to a terminal state so
 * the caller can re-sync markers. `isCurrent` lets the caller cancel stale
 * loads (for example when the view is torn down).
 */
export function ensureAvatarAssets(args: {
  entityModelIds: Iterable<string>;
  cache: AvatarAssetCache;
  onChange: () => void;
  isCurrent: () => boolean;
}): void {
  const { entityModelIds, cache, onChange, isCurrent } = args;
  for (const entityModelId of entityModelIds) {
    const existing = cache.get(entityModelId);
    if (existing && existing.state !== "failed") {
      continue;
    }
    if (existing && existing.retryAttempts >= AVATAR_LOAD_RETRY_LIMIT) {
      continue;
    }

    const entry: AvatarAssetEntry = existing ?? {
      state: "loading",
      template: null,
      activeTexture: null,
      inactiveTexture: null,
      retryAttempts: 0,
    };
    entry.state = "loading";
    cache.set(entityModelId, entry);

    void loadAvatarAsset({ entityModelId, entry, cache, onChange, isCurrent });
  }
}

async function loadAvatarAsset(args: {
  entityModelId: string;
  entry: AvatarAssetEntry;
  cache: AvatarAssetCache;
  onChange: () => void;
  isCurrent: () => boolean;
}): Promise<void> {
  const { entityModelId, entry, cache, onChange, isCurrent } = args;
  const textureLoader = new THREE.TextureLoader();

  const markFailure = (): void => {
    if (!isCurrent() || cache.get(entityModelId) !== entry) {
      return;
    }
    entry.retryAttempts += 1;
    entry.state = "failed";
    onChange();
  };

  try {
    const manifest = await fetchAvatarManifest(entityModelId);
    if (!isCurrent() || cache.get(entityModelId) !== entry) {
      return;
    }

    if (!manifest.available) {
      entry.state = "unavailable";
      onChange();
      return;
    }

    if (!manifest.modelUrl || !manifest.textureUrl) {
      throw new Error("Avatar manifest is missing asset URLs");
    }

    const gltfLoader = createAvatarGltfLoader(manifest);
    const [textureResult, modelResult] = await Promise.allSettled([
      textureLoader.loadAsync(manifest.textureUrl),
      gltfLoader.loadAsync(manifest.modelUrl),
    ]);

    if (!isCurrent() || cache.get(entityModelId) !== entry) {
      if (textureResult.status === "fulfilled") {
        textureResult.value.dispose();
      }
      if (modelResult.status === "fulfilled") {
        disposePlayerMarkerTemplate(modelResult.value.scene);
      }
      return;
    }

    if (
      textureResult.status !== "fulfilled" ||
      modelResult.status !== "fulfilled"
    ) {
      if (textureResult.status === "fulfilled") {
        textureResult.value.dispose();
      }
      if (modelResult.status === "fulfilled") {
        disposePlayerMarkerTemplate(modelResult.value.scene);
      }
      markFailure();
      return;
    }

    const template = createNormalizedAvatarTemplate(
      modelResult.value.scene,
      manifest,
    );
    const activeTexture = textureResult.value;
    activeTexture.colorSpace = THREE.SRGBColorSpace;
    // Cubyz entity model UVs assume an unflipped texture; without this the
    // texture samples the wrong regions and alpha-tested meshes disappear.
    activeTexture.flipY = false;
    activeTexture.magFilter = THREE.NearestFilter;
    activeTexture.minFilter = THREE.NearestFilter;
    activeTexture.needsUpdate = true;

    entry.template = template;
    entry.activeTexture = activeTexture;
    entry.inactiveTexture = createGrayscaleTexture(activeTexture);
    entry.retryAttempts = 0;
    entry.state = "loaded";
    onChange();
  } catch {
    markFailure();
  }
}
